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
import { GroundGuideFeatures, tidyName } from './GroundGuideFeatures';
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
import { checkSpacing, echelonCodeOf, frontBlocks, planFootprint, sideOf, type FootprintCandidate, type FootprintPlan } from './GroundGuideFootprint';
import { GroundGuideIndicators } from './GroundGuideIndicators';
import { buildGridRect, mPerPx, mercToPx, pxToMerc, sightTables, sightTo, visibilityAt, weaponOf, type OcokaGrid } from './GroundGuideOcoka';
import { IPB, codeIpb, ipbMoverOf, ipbReasonsAt, ipbRulesFrom, ipbSummaryText, type IpbCoding, type IpbMover, type IpbReason, type IpbStats } from './GroundGuideIpb';
import { annexA, decide, decRatesFrom, type DecAaIn, type DecCls } from './GroundGuideIpbDecision';
import { GroundGuideIpbMap } from './GroundGuideIpbMap';
import { arrowHeadFrac, arrowTail, attackArrow, findCorridors, simplifyLine, type IpbFrame } from './GroundGuideIpbCorridors';
import { ipbAreas } from './GroundGuideIpbShapes';
import { fireCoverage } from './GroundGuideIpbFire';
import { pfKey, proforma, type PfGroupIn, type PfMeasures, type PfSign } from './GroundGuideIpbProforma';
import { GroundGuideIpbApchMap } from './GroundGuideIpbApchMap';
import { airIpb, airRulesFrom, type AirExisting, type AirLine, type AirLz, type AirObstruction } from './GroundGuideIpbAir';
import { layTemplate, pickTemplate, templatesFrom, tplRulesFrom, type TplAa, type TplMover } from './GroundGuideIpbTemplate';
import IPB_DOCTRINE from '../../Data/IpbDoctrine.json';
import IPB_TEMPLATES from '../../Data/IpbTemplates.json';
import { GroundGuideOcokaMap } from './GroundGuideOcokaMap';
import { DEFAULT_FRONTAGE_M, OCOKA_DOCTRINE, OCOKA_EYES, OCOKA_THREATS, OcokaLive, OcokaVisibility, ocokaPlan, ocokaSight, ocokaViewshed, readOcoka, resolveThreat, type OcokaMapArgs } from './GroundGuideOcokaRead';
import { EXT_TABS, EXT_TAB_KEY, extKey, extScopeText, extendedText, isExtTab } from './GroundGuideExtendedView';
import { GroundGuideThreat } from './GroundGuideThreat';
import { GroundGuideKeyNotice, type KeyNoticeContent, type KeyNoticeKey } from './GroundGuideKeyNotice';
import { catalogKey } from './GroundGuideSpeed';
import type { GroundGuideOcoka, IpbApchAa, IpbAirView, IpbAirZone, IpbApchView, IpbDecisionView, IpbFireView, IpbTemplateView, IpbWxView, OcokaMapPlan, OcokaMapSight, OcokaThreatMode } from './GroundGuideTypes';
import { GroundGuideScope, type ScopeFrame, type ScopeSource } from './GroundGuideScope';
import { aorInputKey, buildAorGrid, readAor, type AorClassTables, type AorInput, type AorReading, type AorSide } from './GroundGuideAor';
import { aorText, type AorFrame } from './GroundGuideScopeAor';
import { GroundGuideAorSheet } from './GroundGuideAorSheet';
import { buildScopeScene, overCodes, scopeHalf, scopeLevel } from './GroundGuideScopeScene';
import { scopeOcokaScene } from './GroundGuideScopeOcoka';
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
  type GroundGuideClearGround,
  type GroundGuideGoingInfo,
  type GroundGuideMovementSector,
  type GroundGuideItg,
  type GroundGuideItgCandidate,
  type GroundGuideIndicator,
  type GroundGuideNearest,
  type GroundGuideOptionIssue,
  type GroundGuideOptions,
  type GroundGuideAorOptions,
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
/**
 * The AOR scale's echelon frame (when there are no bdys or box): width across the front, how far it reaches toward the
 * threat and behind the MITG, metres. A proposal (basis E): the Bn's width is IBB's three coys up with room on the
 * flanks; the user corrects.
 */
const AOR_FRAME = { coy: { w: 2000, fwd: 4000, rear: 800 }, bn: { w: 7000, fwd: 12000, rear: 3000 }, bde: { w: 14000, fwd: 18000, rear: 6000 } } as const;
/** The kind of symbol the Extended View follows: its catalogue key (symbol set + entity), so a Pl and a Coy of tanks are one kind. */
function extKindOf(sidc: string | null | undefined): string | null {
  return catalogKey(sidc) ?? (sidc ? String(sidc) : null);
}

/** A symbol's weapon ranges from the catalogue: the `Rng` field of MS/Data/Symbols.json (see OcokaDoctrine.json for its basis codes). */
const DEFAULT_RANGE_LOOKUP = (key: string): { rng: unknown; name?: string | null } | null => {
  const s = SymbolMetadataService.getByKey(key);
  return s ? { rng: s.Rng ?? null, name: typeof s.Name === 'string' ? s.Name : null } : null;
};
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
/**
 * Clear ground for the hint chip (the snap search run for the cursor, 3–6 ms): at most one search per this many ms
 * while the cursor moves (in between, the spot already found is kept and only its distance and direction follow the
 * cursor; it is still clear ground, just maybe not the nearest for that moment), none while the cursor stays within
 * this many tile pixels of the last one, and one more once the cursor rests.
 */
const CLEAR_INTERVAL_MS = 120;
const CLEAR_REUSE_PX = 1;
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
/** 2525D echelon codes (SIDC digits 9-10) in the short forms the cards use. */
const ECH_SHORT: Record<string, string> = { '11': 'Team', '12': 'Sqd', '13': 'Sec', '14': 'Pl', '15': 'Coy', '16': 'Bn', '17': 'Regt', '18': 'Bde', '21': 'Div', '22': 'Corps', '23': 'Army', '24': 'Army Gp', '25': 'Theatre', '26': 'Comd' };

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
    tab: (t) => {
      if (isExtTab(t)) this._refreshLive(); // the viewshed picture is only traced for the tab that draws it
    },
    extended: (on) => this.setExtended(on), // the Detail's F tab
    // Whose options, in the Detail's key bar (user, 2026-11-14: moved there from tab 3 to save space).
    readFor: { get: () => this._opts.extended.ipb.readFor, set: (r) => this.toggleReadFor(r) },
    opacity: (v) => {
      this.setOptions({ overlay: { ...this._opts.overlay, opacity: v } });
      setSetting(['groundGuide', 'overlay', 'opacity'], v);
      this._syncLegend();
    },
  });
  /** True while the Ground Detail is open (`isDetailOpen`; the older name `isBriefOpen` still works). */
  private _briefOpen = false;
  /** The key notice at the foot of the screen (`card.keyNotice`): a key's new mode, and the keys that work in it. */
  private _keyNotice = new GroundGuideKeyNotice();
  /**
   * The Extended View (F, user 2026-11-12): on or off. Never kept in the settings: it starts off, F turns it on and off,
   * and it goes off with the guide (`disable`), so nothing below is worked out unless it was asked for.
   */
  private _ext = false;
  /** Kept on for every symbol (Shift+F) rather than closing on a new kind of symbol or a cancelled draw. */
  private _extKept = false;
  /** The kind of symbol it was opened for (catalogue key); null until one is armed. A different kind closes it. */
  private _extKind: string | null = null;
  /** This draw ended in a placement (`afterPlace`), not a cancel. */
  private _placedThisDraw = false;
  /**
   * The symbol the Extended View holds on while nothing is being placed: one selected (SymbolEngine passes the selection).
   * A drop no longer holds it (user, 2026-11-14: "when I drop symbol, approaches and other F elements on map, should
   * vanish away"): the products leave the map with the draw and come back with the next one. Its map products and the IPB
   * reading stay still on it until the next draw moves on the map, another symbol is selected or F closes.
   */
  private _extPin: { graphic: any; at: MercXY; sidc: string | null; profile: GroundGuideProfile; frontageM: number } | null = null;
  private _extPinTries = 0;
  private _extPinTimer: ReturnType<typeof setTimeout> | null = null;
  private _extCancelTimer: ReturnType<typeof setTimeout> | null = null;
  /** Extended View: the ground the live reading runs on, the last reading, the month's visibility grid, the threat marker. */
  private _extLive = new OcokaLive();
  /** Its map overlay: the threat's own grid of tiles, what was last drawn from it, and the spot the view from the position was drawn for. */
  private _extOverLive = new OcokaLive();
  private _extOverGrid: OcokaGrid | null = null;
  private _extOverSig = '';
  private _extOverTimer: ReturnType<typeof setTimeout> | null = null;
  private _extViewKey = '';
  private _extTick = 0;
  private _lastExt: GroundGuideOcoka | null = null;
  private _visibility: OcokaVisibility | null = null;
  private _rangeLookup: (key: string) => { rng: unknown; name?: string | null } | null | undefined = DEFAULT_RANGE_LOOKUP;
  private _threatHandle: { remove(): void } | null = null;
  /** The Extended View on the map: the layer, what the last live reading ran on, and the products worked out for it. */
  private _extMap = new GroundGuideOcokaMap(() => this._getView?.());
  /** The IPB coding on the map (extended.overlay: ipb), its own grid of tiles, rules and the last coding. */
  private _ipbMap = new GroundGuideIpbMap(() => this._getView?.());
  private _ipbLive = new OcokaLive();
  private _ipbRules = ipbRulesFrom(IPB_DOCTRINE);
  private _ipbLast: { key: string; grid: OcokaGrid; coding: IpbCoding; centre: MercXY } | null = null;
  /**
   * The IPB avenues of approach over the area read (extended.ipb.apchs, IPB_Plan.md §6.2): where they are wanted (the spot
   * and its symbol), the reading with the coding it was made from, and the timer that works it out once per area.
   */
  private _apchMap = new GroundGuideIpbApchMap(() => this._getView?.());
  private _apchWant: { at: MercXY; sidc: string | null } | null = null;
  private _apch: { key: string; view: IpbApchView; coding: IpbCoding | null; grid: OcokaGrid | null; extent: [number, number, number, number] | null; cframe: IpbFrame | null; cargs?: any } | null = null;
  /**
   * Create on Map (IPB_Plan.md §6.8): SymbolEngine passes how to make symbols (loadSymbolFromJSON) and remove the set
   * made before, as one undo step; the ids made per product, so making it again replaces it.
   */
  private _creator: ((items: any[], label: string, removeIds: string[]) => any[]) | null = null;
  private _ipbMade: Record<'coo' | 'corridors' | 'apchs' | 'event' | 'dst' | 'air' | 'template', string[]> = { coo: [], corridors: [], apchs: [], event: [], dst: [], air: [], template: [] };
  private _airRules = airRulesFrom(IPB_DOCTRINE);
  /** The air reading ran while feature tiles were still loading: run it again when they arrive. */
  private _airFeaturesPending = false;
  private _tplRules = tplRulesFrom(IPB_TEMPLATES);
  /** IPB codings for the template's other movers over the area read (worked out once per area). */
  private _tplCodes: { key: string; codes: Partial<Record<'armour' | 'mech' | 'dismounted', Uint8Array>> } | null = null;
  /**
   * Fire on the avenues and the proforma (extended.ipb.fire / proforma): the timers, the key of what was worked out, the
   * other side's reading over the same area (the proforma's second group), the groups' measures and the user's signs.
   */
  private _fireTimer: ReturnType<typeof setTimeout> | null = null;
  private _otherTimer: ReturnType<typeof setTimeout> | null = null;
  private _fireKey = '';
  private _apchOther: { area: string; view: IpbApchView; grid: OcokaGrid } | null = null;
  private _pfInputs: PfGroupIn[] = [];
  private _pfPending = false;
  private _pfUser: Record<string, PfSign> = {};
  private _pfArea = '';
  private readonly _ipbCreateH = (e: Event): void => {
    const root = this._detail.element;
    if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return; // another host's card
    const kind = (e as CustomEvent).detail?.kind;
    if (kind === 'coo' || kind === 'corridors' || kind === 'apchs' || kind === 'event' || kind === 'dst' || kind === 'all' || kind === 'decision' || kind === 'air' || kind === 'template') this.createIpbOverlay(kind);
  };
  private _apchTimer: ReturnType<typeof setTimeout> | null = null;
  private _apchWaiting = false;
  private _extRead: { key: string; grid: OcokaGrid; ox: number; oy: number } | null = null;
  private _extCtx: { key: string; grid: OcokaGrid; ox: number; oy: number; at: MercXY; lngLat: [number, number]; profile: GroundGuideProfile; reading: GroundGuideOcoka; frontageM: number } | null = null;
  private _extSightKey = '';
  private _extSight: OcokaMapSight | null = null;
  private _extPlanKey = '';
  private _extPlan: OcokaMapPlan | null = null;
  private _extDrawnKey = '';
  private _extSightTimer: ReturnType<typeof setTimeout> | null = null;
  private _extPlanTimer: ReturnType<typeof setTimeout> | null = null;
  private _threat = new GroundGuideThreat({
    container: () => ((this._getView?.() as any)?.container as HTMLElement | null | undefined) ?? null,
    toScreen: (ll) => this._lngLatToScreen(ll),
    toMap: (x, y) => this._screenToLngLat(x, y),
    moved: (ll) => this.setThreat({ threat: 'point', at: [Number(ll[0].toFixed(6)), Number(ll[1].toFixed(6))] }),
    reset: () => this.setThreat({ threat: 'front' }),
  });
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
  /** The last clear-ground search (`_clearFor`): for which symbol / mode / zoom, from where, what it found and when. */
  private _clear: { key: string; origin: MercXY; at: MercXY | null; verdict: GroundGuideVerdictKind | null; searchedM: number; t: number } | null = null;
  /** The search to run once the cursor rests, after a move that reused the last one. */
  private _clearTimer: ReturnType<typeof setTimeout> | null = null;

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
  /**
   * The Gr Scope rail (V; user, 2026-11-08): a side window docked at the map's edge, not tied to the mouse, with the
   * ground round the symbol being placed (else the selected symbol, the one just placed, the map centre).
   */
  private _scope = new GroundGuideScope({
    toggle: (open) => this.showScope(open),
    redraw: () => this._scopeSoon(0, true),
    moved: () => {
      // The Ground Detail stops short of the rail; the cursor card steps aside from it; the map's own corner widgets
      // (zoom, compass) move clear of it.
      const ins = this._scope.inset;
      this._detail.setInset(ins.side, ins.px);
      this._badge.reflow();
      this._scopeUiPad();
      if (this._aorSheet.isOpen && this._aorLast?.reading) this._aorSheet.update(this._aorLast.reading, this._aorLast, this._scope.rect, this._opts.scope.side);
    },
    aor: (act) => this._aorAction(act),
  });
  /** D in the AOR scale: the approach sheets beside the rail. */
  private _aorSheet = new GroundGuideAorSheet(() => undefined);
  /** The bundle's borders (boundaries.geojson: WB, LOC, international), Web Mercator; null until read, [] when the bundle has none. */
  private _aorBorders: Array<{ name: string; xy: Float64Array }> | null = null;
  private _aorBordersUrl = '';
  /** The AOR reading for the inputs in `key`, and the class tables it reads with. */
  private _aorMade: { key: string; reading: AorReading } | null = null;
  private _aorTables: { rules: unknown; t: AorClassTables } | null = null;
  private _aorWork: ReturnType<typeof setTimeout> | null = null;
  private _aorWorkKey = '';
  /** The MITG set through `setAorAnchor()`, Web Mercator; null lets the rail choose. */
  private _aorAnchor: MercXY | null = null;
  /** The last AOR frame drawn on the rail (for the sheets and Copy as Text). */
  private _aorLast: AorFrame | null = null;
  /** A box being dragged for the AOR (armed from the rail or `drawAorBox()`). */
  private _aorBoxDrag: { handle: any; keyH: (e: KeyboardEvent) => void; div: HTMLDivElement | null; start: { x: number; y: number } | null } | null = null;
  /** The view's `ui.padding` before the rail widened it, to put back when the rail goes. */
  private _scopeUi: { view: any; orig: { top: number; right: number; bottom: number; left: number } } | null = null;
  private _scopeTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last live verdict of the draw in progress, for the rail. */
  private _scopeLive: GroundGuideVerdict | null = null;
  /** The one selected symbol (SymbolEngine's selection), and the symbol just placed with the view centre then. */
  private _scopeSelected: any = null;
  private _scopePlaced: { graphic: any; centre: MercXY | null } | null = null;
  /** Class code to the rail's cover code (built-up, trees, nullah), from the bundle's rules. */
  private _scopeOver: Uint8Array | null = null;
  /** What the rail last drew, and a count of tile arrivals, so an unchanged frame is not drawn again. */
  private _scopeKey = '';
  /** The rail in the Extended View, reading a symbol that is not being placed: its grid, its products, and the plan once the spot has rested. */
  private _scopeExtRd: { key: string; grid: OcokaGrid; ox: number; oy: number } | null = null;
  private _scopeExtMade: { key: string; sight: OcokaMapSight; plan: OcokaMapPlan | null } | null = null;
  private _scopePlanKey = '';
  private _scopePlanTimer: ReturnType<typeof setTimeout> | null = null;
  private _scopeTick = 0;
  private _north = 0;
  private _lastClient: { x: number; y: number } | null = null;
  private _container: HTMLElement | null = null;
  private _pointerHandler: ((e: PointerEvent) => void) | null = null;
  private _stationaryHandle: { remove(): void } | null = null;
  private _northHandle: { remove(): void } | null = null;

  constructor(private _getView: () => any) {
    // The cursor card keeps clear of the open Ground Detail (user, 2026-11-08, item 7: step aside, then chip) and of the
    // Gr Scope rail docked at the map's edge.
    this._badge.setAvoid(() => {
      const d = this._briefOpen ? this._detail.rect : null;
      const s = this._scope.rect;
      return d && s ? [d, s] : (d ?? s);
    });
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
    this._scopeOver = null;
    this._syncScope(); // no bundle while it loads: the rail goes until it is ready
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
      const vm = (manifest.grotbc as any)?.visibility;
      this._visibility = typeof vm?.index === 'string' && typeof vm?.data === 'string' ? new OcokaVisibility(`${base}/${vm.index}`, `${base}/${vm.data}`, () => this._onTilesChanged(false)) : null;
      this._extLive.clear();
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
    const so = patch.scope;
    next.scope = { ...prev.scope };
    if (so && typeof so === 'object') {
      flag('scope.enabled', so.enabled, (b) => (next.scope.enabled = b));
      pick('scope.side', so.side, ['right', 'left'] as const, (x) => (next.scope.side = x));
      flag('scope.tab', so.tab, (b) => (next.scope.tab = b));
      num('scope.topPx', so.topPx, 0, 400, (n) => (next.scope.topPx = n), true);
    }
    const oc = patch.extended;
    next.extended = { ...prev.extended, ipb: { ...DEFAULT_GROUND_GUIDE_OPTIONS.extended.ipb, ...(prev.extended.ipb ?? {}) } };
    if (oc && typeof oc === 'object') {
      flag('extended.keys', oc.keys, (b) => (next.extended.keys = b));
      pick('extended.lasts', oc.lasts, ['symbol', 'once', 'kept'] as const, (x) => (next.extended.lasts = x));
      pick('extended.threat', oc.threat, OCOKA_THREATS, (x) => (next.extended.threat = x));
      if (oc.bearingDeg !== undefined) {
        if (typeof oc.bearingDeg === 'number' && Number.isFinite(oc.bearingDeg)) next.extended.bearingDeg = ((oc.bearingDeg % 360) + 360) % 360;
        else bad('extended.bearingDeg', oc.bearingDeg, 'must be a number of degrees');
      }
      num('extended.sectorDeg', oc.sectorDeg, 30, 180, (n) => (next.extended.sectorDeg = n));
      if (oc.at !== undefined) {
        const a = oc.at as unknown;
        if (a === null) next.extended.at = null;
        else if (Array.isArray(a) && a.length === 2 && a.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(a[0]) <= 180 && Math.abs(a[1]) <= 90) next.extended.at = [a[0], a[1]];
        else bad('extended.at', a, 'must be [longitude, latitude] or null');
      }
      flag('extended.marker', oc.marker, (b) => (next.extended.marker = b));
      num('extended.radiusKm', oc.radiusKm, 1, 10, (n) => (next.extended.radiusKm = n));
      pick('extended.eye', oc.eye, OCOKA_EYES, (x) => (next.extended.eye = x));
      flag('extended.surface', oc.surface, (b) => (next.extended.surface = b));
      flag('extended.mapFan', oc.mapFan, (b) => (next.extended.mapFan = b));
      flag('extended.mapEnemy', oc.mapEnemy, (b) => (next.extended.mapEnemy = b));
      flag('extended.mapSight', oc.mapSight, (b) => (next.extended.mapSight = b));
      flag('extended.mapApproaches', oc.mapApproaches, (b) => (next.extended.mapApproaches = b));
      flag('extended.mapBetter', oc.mapBetter, (b) => (next.extended.mapBetter = b));
      pick('extended.overlay', oc.overlay, ['auto', 'view', 'threat', 'going', 'ipb'] as const, (x) => (next.extended.overlay = x));
      const ip = oc.ipb;
      if (ip && typeof ip === 'object') {
        pick('extended.ipb.readFor', ip.readFor, ['defence', 'attack'] as const, (x) => (next.extended.ipb.readFor = x));
        pick('extended.ipb.mover', ip.mover, ['auto', 'armour', 'mech', 'dismounted'] as const, (x) => (next.extended.ipb.mover = x));
        pick('extended.ipb.season', ip.season, ['coding', 'notes'] as const, (x) => (next.extended.ipb.season = x));
        num('extended.ipb.avlbSpanM', ip.avlbSpanM, 3, 60, (n) => (next.extended.ipb.avlbSpanM = n));
        pick('extended.ipb.paint', ip.paint, ['hatch', 'soft', 'atp'] as const, (x) => (next.extended.ipb.paint = x));
        flag('extended.ipb.apchs', ip.apchs, (b) => (next.extended.ipb.apchs = b));
        pick('extended.ipb.hq', ip.hq, ['auto', 'bde', 'div'] as const, (x) => (next.extended.ipb.hq = x));
        flag('extended.ipb.mapCorridors', ip.mapCorridors, (b) => (next.extended.ipb.mapCorridors = b));
        pick('extended.ipb.labels', ip.labels, ['auto', 'all', 'off'] as const, (x) => (next.extended.ipb.labels = x));
        pick('extended.ipb.createAs', ip.createAs, ['attack', 'avenue'] as const, (x) => (next.extended.ipb.createAs = x));
        flag('extended.ipb.fire', ip.fire, (b) => (next.extended.ipb.fire = b));
        flag('extended.ipb.mapFire', ip.mapFire, (b) => (next.extended.ipb.mapFire = b));
        flag('extended.ipb.proforma', ip.proforma, (b) => (next.extended.ipb.proforma = b));
        flag('extended.ipb.decision', ip.decision, (b) => (next.extended.ipb.decision = b));
        flag('extended.ipb.mapDecision', ip.mapDecision, (b) => (next.extended.ipb.mapDecision = b));
        num('extended.ipb.reactionH', ip.reactionH, 0, 12, (n) => (next.extended.ipb.reactionH = n));
        flag('extended.ipb.air', ip.air, (b) => (next.extended.ipb.air = b));
        flag('extended.ipb.mapAir', ip.mapAir, (b) => (next.extended.ipb.mapAir = b));
        pick('extended.ipb.airBand', ip.airBand, ['noe', 'contour', 'low'] as const, (x) => (next.extended.ipb.airBand = x));
        num('extended.ipb.lzClass', ip.lzClass, 1, 6, (n) => (next.extended.ipb.lzClass = Math.round(n)));
        num('extended.ipb.lzPoints', ip.lzPoints, 1, 12, (n) => (next.extended.ipb.lzPoints = Math.round(n)));
        if (ip.template !== undefined) {
          const ids = ['auto', 'off', ...templatesFrom(IPB_TEMPLATES).map((t) => t.id)];
          if (typeof ip.template === 'string' && ids.includes(ip.template)) next.extended.ipb.template = ip.template;
          else bad('extended.ipb.template', ip.template, `must be one of ${ids.join(', ')}`);
        }
        flag('extended.ipb.mapTemplate', ip.mapTemplate, (b) => (next.extended.ipb.mapTemplate = b));
        if (ip.hHour !== undefined) {
          if (typeof ip.hHour === 'string' && (ip.hHour.trim() === '' || /^([01]?\d|2[0-3]):([0-5]\d)$/.test(ip.hHour.trim()))) next.extended.ipb.hHour = ip.hHour.trim();
          else bad('extended.ipb.hHour', ip.hHour, 'must be HH:MM (24 h) or empty');
        }
        for (const k of ['pfHead1', 'pfHead2'] as const) {
          const h = (ip as any)[k];
          if (h === undefined) continue;
          if (typeof h === 'string') next.extended.ipb[k] = h.slice(0, 24);
          else bad(`extended.ipb.${k}`, h, 'must be a heading (text)');
        }
      }
    }
    const ao = patch.aor;
    next.aor = { ...prev.aor };
    if (ao && typeof ao === 'object') {
      flag('aor.keys', ao.keys, (b) => (next.aor.keys = b));
      pick('aor.scale', ao.scale, ['spot', 'aor'] as const, (x) => (next.aor.scale = x));
      pick('aor.layout', ao.layout, ['deductions', 'model', 'appreciation'] as const, (x) => (next.aor.layout = x));
      pick('aor.style', ao.style, ['trace', 'dark'] as const, (x) => (next.aor.style = x));
      pick('aor.orient', ao.orient, ['north', 'threat'] as const, (x) => (next.aor.orient = x));
      pick('aor.source', ao.source, ['boundaries', 'box', 'echelon'] as const, (x) => (next.aor.source = x));
      pick('aor.echelon', ao.echelon, ['auto', 'coy', 'bn', 'bde'] as const, (x) => (next.aor.echelon = x));
      num('aor.leadKm', ao.leadKm, 0, 30, (n) => (next.aor.leadKm = n));
      num('aor.corridorM', ao.corridorM, 0, 10000, (n) => (next.aor.corridorM = n), true);
      if (ao.box !== undefined) {
        const b = ao.box as unknown;
        if (b === null) next.aor.box = null;
        else if (Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isFinite(n)) && b[0] < b[2] && b[1] < b[3]) next.aor.box = [b[0], b[1], b[2], b[3]];
        else bad('aor.box', b, 'must be [west, south, east, north] in degrees, or null');
      }
      if (ao.profile !== undefined) {
        if (typeof ao.profile === 'string' && this._rules?.profiles?.[ao.profile] && ao.profile !== 'exempt') next.aor.profile = ao.profile as GroundGuideProfile;
        else if (!this._rules && typeof ao.profile === 'string') next.aor.profile = ao.profile as GroundGuideProfile;
        else bad('aor.profile', ao.profile, 'must be a mode of the bundle (tracked, wheeled, dismounted...)');
      }
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
    if (!next.extended.keys && this._ext) this._setExt(false, false); // its key gone: the Extended View goes with it
    if (JSON.stringify(next.extended) !== JSON.stringify(prev.extended) || next.footprint.bearingDeg !== prev.footprint.bearingDeg || next.mode !== prev.mode) this._extChanged();
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
    if (JSON.stringify(next.scope) !== JSON.stringify(prev.scope)) this._syncScope();
    else if (next.units !== prev.units || next.nearThresholdM !== prev.nearThresholdM) this._scopeSoon(0, true);
    if (JSON.stringify(next.aor) !== JSON.stringify(prev.aor)) {
      if (next.aor.scale !== prev.aor.scale) {
        this._syncThreat(); // the threat marker shows in the AOR scale too
        if (next.aor.scale !== 'aor') this._aorSheet.close();
        this._emit('ground-guide-scope', { open: this._scope.isShown, scale: next.aor.scale });
      }
      this._scopeSoon(0, true);
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
    document.addEventListener('ms-gg-ipb-create', this._ipbCreateH);
    document.addEventListener('ms-gg-ipb-tpl', this._tplPickH);
    document.addEventListener('ms-gg-ipb-pf', this._pfClickH);
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
    document.removeEventListener('ms-gg-ipb-create', this._ipbCreateH);
    document.removeEventListener('ms-gg-ipb-tpl', this._tplPickH);
    document.removeEventListener('ms-gg-ipb-pf', this._pfClickH);
    this._setExt(false, false, false, 'guide'); // leaving the Ground Guide closes the Extended View (user, 2026-11-12)
    this._syncThreat();
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
    this._keyNotice.hide();
    this._boundary.hide();
    this._syncScope();
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
    this._placedThisDraw = false;
    this._extOnArm(this._activeSidc);
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
    // A re-arm mid-draw (the dock's echelon, identity or a parameter changed while placing): judged again at once with the
    // new symbol, not when the cursor next moves (user, 2026-11-14: the Detail still gave the old echelon).
    const live = this._lastDetail;
    if (live && this._activeSidc && live.sidc !== this._activeSidc && this._activeProfile !== 'exempt') {
      this._lastDetail = { geometry: live.geometry, sidc: this._activeSidc };
      this._lastKey = '';
      this._lastBadgeKey = '';
      this._apply(this._judgeLive(live.geometry, this._activeSidc));
    }
  }

  /** Hot path. Called for every onDrawProgress of the engine's own view. */
  onDrawProgress(detail: any): void {
    if (!this.isActive) return;
    const geometry = detail?.currentGeometry;
    if (!geometry) return;
    if (this._extPin) this._extPinRelease(); // a new draw on the map: the Extended View follows the cursor again
    const first = this._lastDetail === null;
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
    if (first && this._ext) {
      // The draw's first move on the map: the Extended View's products come back (they left with the last drop).
      this._syncOverlay();
      this._apchDraw();
    }
  }

  /**
   * The Extended View draws on the map only while a symbol is being placed (the cursor on the map) or a selected symbol
   * holds it (user, 2026-11-14: "when I drop symbol, approaches and other F elements on map, should vanish away").
   */
  private _extHere(): boolean {
    return this._lastDetail !== null || this._extPin !== null;
  }

  // ── Gr Scope rail (V) ────────────────────────────────────────────────────

  /** True while the Gr Scope rail is on screen. */
  get isScopeOpen(): boolean {
    return this._scope.isShown;
  }

  /**
   * Show or hide the Gr Scope rail (V does this): a side window docked at the map's edge with the ground round the
   * symbol being placed, else the selected symbol, the one just placed, the map centre. The choice is remembered.
   * Shown only while the guide is on with a bundle and `scope.enabled`.
   */
  showScope(open = !this._scope.wanted): void {
    this._scope.setShown(open);
    this._syncScope();
    if (open) this._scopeSoon(0, true);
    else this._aorSheet.close();
    this._syncThreat();
    this._emit('ground-guide-scope', { open: this._scope.isShown, scale: this._opts.aor.scale });
  }

  /**
   * The symbol the rail reads while nothing is being placed: the one selected symbol (SymbolEngine passes its selection
   * here), or null.
   */
  setScopeTarget(graphic: any | null): void {
    const g = graphic?.geometry ? graphic : null;
    if (g === this._scopeSelected) return;
    this._scopeSelected = g;
    // With the Extended View on, selecting a point symbol moves its reading to that symbol (and holds it there);
    // clearing the selection takes it off the map.
    if (g && this._ext && !this._lastDetail && g.geometry?.type === 'point') this._extPinTo(g);
    else if (!g && this._extPin && !this._lastDetail) this._extOffMap();
    this._scopeSoon(0);
  }

  /** Dock the rail to the view and show it when it may (guide on, bundle ready, `scope.enabled`); the Detail leaves it room. */
  private _syncScope(): void {
    const on = this._enabled && this._opts.scope.enabled && this._manifest !== null;
    this._scope.setOptions({ side: this._opts.scope.side, tab: this._opts.scope.tab, topPx: this._opts.scope.topPx });
    const view: any = this._getView?.();
    this._scope.attach(on ? (view?.container ?? null) : null, view?.padding ?? null);
    this._scope.setEnabled(on);
    if (on && this._scope.wanted) this._scopeSoon(0, true);
  }

  /**
   * While the rail is shown, widen the view's UI padding on its side by the room it takes, so ArcGIS's own corner widgets
   * (zoom, compass, home) are not hidden under it; put the host's padding back when it goes or the view changes.
   */
  private _scopeUiPad(): void {
    const view: any = this._getView?.();
    const r = this._scope.rect;
    const was = this._scopeUi;
    if (was && (was.view !== view || !r)) {
      try {
        was.view.ui.padding = was.orig;
      } catch {
        /* the old view is gone */
      }
      this._scopeUi = null;
    }
    const ui = view?.ui;
    const c = view?.container?.getBoundingClientRect?.();
    if (!r || !ui || !c) return;
    if (!this._scopeUi) {
      const p = ui.padding ?? {};
      const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      const all = typeof p === 'number' ? p : null;
      this._scopeUi = { view, orig: { top: all ?? n(p.top, 15), right: all ?? n(p.right, 15), bottom: all ?? n(p.bottom, 15), left: all ?? n(p.left, 15) } };
    }
    const o = this._scopeUi.orig;
    const right = this._opts.scope.side === 'right';
    const extra = Math.max(0, Math.round(right ? c.right - r.left : r.right - c.left));
    try {
      ui.padding = right ? { ...o, right: o.right + extra } : { ...o, left: o.left + extra };
    } catch {
      /* a view without UI padding */
    }
  }

  /** Draw the rail again soon (it follows the draw at a few frames a second, not every mouse move). */
  private _scopeSoon(ms = 140, force = false): void {
    if (force) this._scopeKey = '';
    if (!this._scope.isShown) return;
    if (this._scopeTimer !== null) {
      if (ms > 0) return;
      clearTimeout(this._scopeTimer);
    }
    this._scopeTimer = setTimeout(() => {
      this._scopeTimer = null;
      try {
        this._scopeRender();
      } catch (e) {
        EngineLogger.error(ENGINE, `Gr Scope: ${(e as Error)?.message ?? e}`);
      }
    }, ms);
  }

  /** Work out what the rail reads and draw it. */
  private _scopeRender(): void {
    if (!this._scope.isShown || !this.isActive || !this._manifest || !this._cache) return;
    if (this._opts.aor.scale === 'aor') return this._aorRender();
    const view: any = this._getView?.();
    // What it reads: the symbol being placed, the selected symbol, the one just placed, the map centre.
    let source: ScopeSource;
    let geometry: any;
    let sidc: string | null = null;
    let v: GroundGuideVerdict | null = null;
    let graphic: any = null;
    const live = this._lastDetail;
    if (live && this._scopeLive) {
      source = 'drawing';
      geometry = live.geometry;
      sidc = live.sidc;
      v = this._scopeLive;
    } else if (this._scopeSelected?.geometry) {
      source = 'selected';
      graphic = this._scopeSelected;
    } else if (this._scopePlaced?.graphic?.geometry) {
      source = 'placed';
      graphic = this._scopePlaced.graphic;
    } else {
      source = 'centre';
      geometry = view?.center;
    }
    if (graphic) {
      geometry = graphic.geometry;
      sidc = graphicSidc(graphic);
    }
    const shape = geometry ? toMercatorShape(geometry) : null;
    const first = shape?.parts[0]?.[0];
    if (!shape || !first) return;

    // The spot, and for a line or area how far it reaches from it.
    let centre: MercXY = first;
    let needM = 0;
    const isPoint = geometry.type === 'point';
    if (!isPoint) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const part of shape.parts) for (const [x, y] of part) ((x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y)));
      centre = [(x0 + x1) / 2, (y0 + y1) / 2];
      const lat0 = 2 * Math.atan(Math.exp(centre[1] / 6378137)) - Math.PI / 2;
      needM = (Math.max(x1 - x0, y1 - y0) / 2) * Math.cos(lat0) * 1.15;
    }
    const lat = 2 * Math.atan(Math.exp(centre[1] / 6378137)) - Math.PI / 2;
    const k = 1 / Math.max(Math.cos(lat), 1e-6); // Web Mercator metres per ground metre here

    const effSidc = sidc ?? (source === 'drawing' ? this._activeSidc : null);
    // The mode (as the audit does: a mode set by hand when the symbol was placed is kept).
    let profile: GroundGuideProfile;
    if (graphic) {
      const stamp = readStamp(graphic);
      profile = stamp?.profileOverride && this.profileChoices.includes(stamp.profile) ? stamp.profile : resolveProfile(sidc, this._rules);
    } else profile = v ? v.profile : this._legendProfile();
    // The Extended View: the reading first, as the map must hold the weapon's fan. A symbol being placed brings its own
    // (with the map products); any other spot is read here from the tiles in memory. Off: nothing is read.
    const extOn = this._ext && (isPoint || source === 'centre'); // it rests on a line or area
    let ext: GroundGuideOcoka | null = null;
    if (extOn) {
      ext = source === 'drawing' ? (v?.ext ?? null) : this._scopeExtRead(centre, profile, effSidc);
      if (ext) needM = Math.max(needM, ext.obstacle.rangeM * 1.06);
    }
    const extPart = !extOn ? '' : !ext ? 'x-' : `x${source === 'drawing' ? '' : (this._scopeExtRd?.key ?? '')}|${extKey(ext)}|${ext.sight ? 1 : 0}${ext.plan ? 1 : 0}|${this._scopePlanKey}`;
    const code = isPoint ? echelonCodeOf(effSidc) : null;
    const level = scopeLevel(code, needM, !!ext && isPoint);
    const north = this._north;
    const half = scopeHalf(level.radiusM, north);
    const m = this._manifest;
    // The coarsest bundle zoom still as fine as a cell.
    const cellMerc = ((2 * half) / 96) * k;
    let z = m.zoom.max;
    while (z > m.zoom.min && resolutionAt(z - 1, m.tileSize) <= cellMerc) z--;

    // The frame key: an unchanged spot, verdict, rotation and data are not drawn again.
    const vKey = v ? `${v.verdict}|${v.message}|${Math.round(v.fraction * 100)}|${v.clear?.distanceM ?? ''}|${v.loading ? 1 : 0}|${v.footprint?.front?.map((b) => Math.round(b.nogo * 9)).join('') ?? ''}` : '';
    const key = [source, Math.round(centre[0] / cellMerc), Math.round(centre[1] / cellMerc), level.radiusM, Math.round(north), z, vKey, this._scopeTick, graphic?.attributes?.id ?? '', effSidc ?? '', extPart].join('|');
    if (key === this._scopeKey) return;

    // A placed symbol is judged now.
    if (graphic) {
      v = this.evaluateGeometry(geometry, sidc, { profile, self: graphic });
      const inNoGo = v.verdict === 'in' || v.verdict === 'partial' || (v.verdict === 'near' && v.fraction > 0);
      if (isPoint && inNoGo && !v.loading) {
        const f = this._findSnap(geometry, sidc);
        if (f.at) {
          const dx = f.at[0] - first[0];
          const dy = f.at[1] - first[1];
          const b = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
          v.clear = { at: f.at, distanceM: Math.hypot(dx, dy) / k, bearingDeg: b, compass: COMPASS[Math.round(b / 45) % 8], verdict: f.verdict, searchedM: f.searchedM };
        } else if (!f.loading) v.clear = { at: null, distanceM: null, bearingDeg: null, compass: null, verdict: null, searchedM: f.searchedM };
      }
    }
    if (ext && source !== 'drawing') {
      // The cover letter's own reading for the C line, and the map products for this spot and frontage.
      if (v && !v.cover) {
        try {
          v.cover = this._coverNear(geometry, v);
        } catch {
          /* the rail does without the cover line */
        }
      }
      ext = this._scopeExtProducts(ext, centre, profile, v?.footprint?.frontageM || DEFAULT_FRONTAGE_M);
      // The map centre is not a position: no better one is offered for it.
      if (source === 'centre' && ext.plan?.better) ext = { ...ext, plan: { ...ext.plan, better: null } };
    }
    const compiled = this._profile(profile);

    // The tiles the map needs (deduplicated by the cache), then the grids from what is in memory.
    const { cls, dist } = this._layerNames(profile);
    const a = mercatorToTilePixel(centre[0] - half * k, centre[1] + half * k, z, m.tileSize);
    const b = mercatorToTilePixel(centre[0] + half * k, centre[1] - half * k, z, m.tileSize);
    const n = 2 ** z;
    for (let ty = Math.max(0, a.ty); ty <= Math.min(n - 1, b.ty); ty++) {
      for (let tx = Math.max(0, a.tx); tx <= Math.min(n - 1, b.tx); tx++) {
        this._cache.request(cls, z, tx, ty);
        if (dist) this._cache.request(dist, z, tx, ty);
      }
    }
    const ctx = this._readContext(profile, z);
    const feats = this._features?.sceneNear(centre, half * 1.05) ?? { points: [], lines: [], pending: false };
    const scene = buildScopeScene({
      centre,
      level,
      northDeg: north,
      read: (mx, my) => this._read(ctx, mx, my),
      profile: compiled.exempt ? null : compiled,
      nearM: this._opts.nearThresholdM,
      overOf: (this._scopeOver ??= overCodes(this._rules)),
      points: feats.points,
      lines: feats.lines,
    });

    const fp = v?.footprint ?? null;
    const local = (p: MercXY): [number, number] => [(p[0] - centre[0]) / k, (p[1] - centre[1]) / k];
    const g = v?.going;
    const season = g?.season ?? this._viewSeason();
    const month = g?.month || resolveMonth(this._opts.going.month);
    const light = v?.speed?.light ?? this._opts.speed.light;
    const frame: ScopeFrame = {
      source,
      scene,
      northDeg: north,
      verdict: v,
      profile,
      profileLabel: this._rules?.profiles?.[profile]?.label ?? profile,
      echelon: fp ? { name: fp.echelon, frontageM: fp.frontageM, depthM: fp.depthM, facingDeg: fp.facing === 'circle' ? null : fp.facingDeg } : null,
      when: { season, text: `${season === 'wet' ? 'After rain' : 'Dry'} · ${monthName(month)} · ${light === 'night' ? 'Night' : 'Day'}` },
      extended: extOn,
      ext: ext ? { scene: scopeOcokaScene(ext, centre, this._threatMerc()), text: extScopeText(ext, v) } : null,
      keys: {
        snap: source === 'drawing' && !!v?.snappable,
        detail: this._opts.card.briefKey && !this._touchInput,
        better: source === 'drawing' && isPoint && !this._touchInput,
        ext: this._opts.extended.keys && !this._touchInput,
      },
      outline: isPoint ? null : shape.parts.map((part) => Float64Array.from(part.flatMap((p) => local(p)))),
      closed: geometry.type === 'polygon',
      clearAt: v?.clear?.at && isPoint ? local(v.clear.at) : null,
      loading: ctx.waiting || feats.pending || !!ext?.pending,
    };
    this._scopeKey = frame.loading ? '' : key; // still loading: the next tile draws it again
    this._scope.render(frame);
  }

  // ── Extended View map overlay ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * What the map overlay paints while the Extended View is on (`extended.overlay`, with `overlay.enabled`): `threat`
   * all the ground the threat may see from its place, `view` all the ground that may be seen from the position being
   * placed, `going` the GROTBC paint. Null: the overlay is off, the Extended View is off, or `threat` was asked for and
   * the threat is not a place.
   */
  private _extOverlayKind(): 'threat' | 'view' | 'going' | 'ipb' | null {
    const o = this._opts.extended;
    if (!(this._enabled && this._manifest !== null && this._opts.mode !== 'off' && this._opts.overlay.enabled && this._ext)) return null;
    if (o.overlay === 'going') return 'going';
    if (o.overlay === 'ipb') return 'ipb';
    if (o.overlay === 'view') return 'view';
    const place = o.threat === 'point' && !!o.at;
    return place ? 'threat' : o.overlay === 'threat' ? null : 'view';
  }

  /** Work the Extended View's overlay out again soon: turned on or off, a new threat place, option, view or tile. */
  private _extOverlaySoon(ms = 150): void {
    if (this._extOverTimer !== null) clearTimeout(this._extOverTimer);
    this._extOverTimer = setTimeout(() => {
      this._extOverTimer = null;
      try {
        this._extOverlayDraw();
      } catch (err) {
        console.error('[Ground Guide] Extended View overlay', err);
      }
    }, ms);
  }

  /**
   * The threat's view: all the ground it may see from its place out to `extended.radiusKm`, read from its own grid of
   * tiles (asked for here), for a vehicle commander's eye (2.4 m: never understated) looking for the mode's unit. It
   * does not follow the cursor: it is worked out again only for a new place, option or tile. The view from the
   * position is drawn by `_extDraw` once the cursor rests; here it is only cleared when nothing is being placed.
   */
  private _extOverlayDraw(): void {
    const kind = this._extOverlayKind();
    if (kind !== null && kind !== 'going' && !this._extHere()) {
      // Nothing being placed or held: the Extended View's paint is off the map (the GROTBC paint is back, _syncOverlay).
      this._extOverSig = '';
      this._extOverGrid = null;
      this._extViewKey = '';
      this._extMap.showOverlay(null);
      this._ipbMap.clear();
      this._ipbLast = null;
      return;
    }
    if (kind === 'ipb') {
      this._extOverSig = '';
      this._extOverGrid = null;
      this._extViewKey = '';
      this._extMap.showOverlay(null);
      this._ipbDraw();
      return;
    }
    // Not the IPB coding: it goes (and nothing of it is worked out) the moment it is not asked for, or F is off.
    this._ipbMap.clear();
    this._ipbLast = null;
    if (kind !== 'threat') {
      this._extOverSig = '';
      this._extOverGrid = null;
      // The threat's view goes at once when it is no longer asked for; the view from the position goes when nothing is
      // being placed (`_extDraw` draws it again where the cursor rests).
      if (kind !== 'view' || !this._extCtx || this._extMap.overlayKind === 'threat') {
        this._extViewKey = '';
        this._extMap.showOverlay(null);
        this._extDrawnKey = ''; // the threat's wedge toward the position is drawn again
      }
      return;
    }
    const at = this._threatMerc();
    const m = this._manifest;
    const cache = this._cache;
    const L = this._sectionLayers();
    if (!at || !m || !cache || !L.elevHi || !L.elevLo) return this._extMap.showOverlay(null);
    const o = this._opts.extended;
    const profile = this._legendProfile();
    const z = m.zoom.max;
    const ts = m.tileSize;
    const lat = mercatorToLngLat(at[0], at[1])[1];
    const radiusM = o.radiusKm * 1000;
    const reach = (radiusM + 600) * Math.cosh(at[1] / 6378137);
    const a = mercatorToTilePixel(at[0] - reach, at[1] + reach, z, ts);
    const b = mercatorToTilePixel(at[0] + reach, at[1] - reach, z, ts);
    const n = 2 ** z;
    const layers = { cls: this._layerNames(profile).cls, elevHi: L.elevHi, elevLo: L.elevLo, bld: L.bld };
    for (let ty = Math.max(0, a.ty); ty <= Math.min(n - 1, b.ty); ty++) {
      for (let tx = Math.max(0, a.tx); tx <= Math.min(n - 1, b.tx); tx++) {
        for (const layer of [layers.cls, layers.elevHi, layers.elevLo, layers.bld]) if (layer) cache.request(layer, z, tx, ty);
      }
    }
    const [cx, cy] = mercToPx(at[0], at[1], z, ts);
    const peek = (layer: string, x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? null : cache.peek(layer, z, x, y));
    const grid = this._extOverLive.grid(peek, layers, z, ts, lat, cx, cy, radiusM / mPerPx(lat, z, ts) + 4, this._extTick);
    const month = resolveMonth(this._opts.going.month);
    const own = profile === 'tracked' || profile === 'amphibious' ? 2.4 : 1.7;
    const sig = [at[0], at[1], radiusM, month, o.surface, own].join('|');
    if (grid === this._extOverGrid && sig === this._extOverSig) return; // the same ground, place and options
    this._extOverGrid = grid;
    this._extOverSig = sig;
    this._extViewKey = '';
    this._extMap.setOverlayLabels(o.ipb.labels !== 'off');
    this._extMap.showOverlay(ocokaViewshed({ grid, ox: cx - grid.px0, oy: cy - grid.py0, at, kind: 'threat', eyeM: 2.4, targetM: own, radiusM, month, surface: o.surface }));
  }

  /**
   * The IPB combined obstacle overlay (extended.overlay: ipb; IPB_Plan.md §6.1): the ground within the observation radius
   * of the symbol being placed (else the map centre) coded GO / SLOW-GO / NO-GO by the IPB book's criteria, with "not
   * assessed" where the bundle cannot test one. The centre snaps to a third of the radius, so it is worked out once per
   * area, not per mouse move; only while the Extended View is on.
   */
  private _ipbDraw(): void {
    const m = this._manifest;
    const cache = this._cache;
    const L = this._sectionLayers();
    const view: any = this._getView?.();
    if (!m || !cache || !L.elevHi || !L.elevLo) return this._ipbMap.clear();
    // The avenues read a whole area: paint its coding (the same one they were found on) rather than the circle round the spot.
    const ap = this._apchOn() ? this._apch : null;
    if (ap?.coding && ap.grid && ap.extent) {
      const k2 = `apch|${ap.key}|${this._opts.extended.ipb.paint}`;
      if (this._ipbMap.shownKey === k2) return;
      this._ipbMap.show(ap.coding, ap.extent, this._opts.extended.ipb.paint, k2);
      this._ipbLast = { key: k2, grid: ap.grid, coding: ap.coding, centre: ap.view.anchor };
      this._emit('ground-guide-ipb', { summary: ipbSummaryText(ap.coding), stats: ap.coding.stats, ms: ap.coding.ms, mover: ap.coding.mover, moveDeg: ap.coding.moveDeg });
      return;
    }
    const spot = this._extCtx?.at ?? null;
    const vc = view?.center && Number.isFinite(view.center.x) ? ([view.center.x, view.center.y] as MercXY) : null;
    const at0 = spot ?? vc;
    if (!at0) return this._ipbMap.clear();
    const o = this._opts.extended;
    const lat0 = mercatorToLngLat(at0[0], at0[1])[1];
    const radiusM = o.radiusKm * 1000;
    const snap = radiusM / 3 / Math.cos((lat0 * Math.PI) / 180); // Mercator metres
    const centre: MercXY = [Math.round(at0[0] / snap) * snap, Math.round(at0[1] / snap) * snap];
    const r = this._ipbCode(centre, {});
    if (!r) return this._ipbMap.clear();
    const { coding, grid, key, extent } = r;
    if (this._ipbMap.shownKey === key) return;
    this._ipbMap.show(coding, extent, o.ipb.paint, key);
    this._ipbLast = { key, grid, coding, centre };
    this._emit('ground-guide-ipb', { summary: ipbSummaryText(coding), stats: coding.stats, ms: coding.ms, mover: coding.mover, moveDeg: coding.moveDeg });
  }

  /** Code the IPB overlay round a centre from the tiles in memory (asks for the missing ones). Null when the bundle cannot. */
  private _ipbCode(
    centre: MercXY,
    over: { radiusKm?: number; mover?: IpbMover; readFor?: 'defence' | 'attack'; month?: number; season?: 'coding' | 'notes'; avlbSpanM?: number; threatDeg?: number },
  ): { coding: IpbCoding; grid: OcokaGrid; key: string; extent: [number, number, number, number] } | null {
    const m = this._manifest;
    const cache = this._cache;
    const L = this._sectionLayers();
    if (!m || !cache || !L.elevHi || !L.elevLo) return null;
    const o = this._opts.extended;
    const ip = o.ipb;
    const z = m.zoom.max;
    const ts = m.tileSize;
    const [lon, lat] = mercatorToLngLat(centre[0], centre[1]);
    const radiusM = Math.min(10, Math.max(1, over.radiusKm ?? o.radiusKm)) * 1000;
    const profile = this._legendProfile();
    const layers = { cls: this._layerNames(profile).cls, elevHi: L.elevHi, elevLo: L.elevLo, bld: null };
    const reach = (radiusM + 1200) / Math.cos((lat * Math.PI) / 180);
    const a = mercatorToTilePixel(centre[0] - reach, centre[1] + reach, z, ts);
    const b = mercatorToTilePixel(centre[0] + reach, centre[1] - reach, z, ts);
    const n = 2 ** z;
    for (let ty = Math.max(0, a.ty); ty <= Math.min(n - 1, b.ty); ty++)
      for (let tx = Math.max(0, a.tx); tx <= Math.min(n - 1, b.tx); tx++) for (const layer of [layers.cls, layers.elevHi, layers.elevLo]) cache.request(layer, z, tx, ty);
    const [cx, cy] = mercToPx(centre[0], centre[1], z, ts);
    const peek = (layer: string, x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? null : cache.peek(layer, z, x, y));
    const res = mPerPx(lat, z, ts);
    const rPx = radiusM / res;
    // A margin of 1.2 km round the area so the 1 km windows (relief, roads) and the BUA bypass rows see past its edge.
    const grid = this._ipbLive.grid(peek, layers, z, ts, lat, cx, cy, rPx + 1200 / res + 2, this._extTick);
    // The direction of movement: the enemy's toward the area (from the threat) for defence, own toward the threat for attack.
    const thr = over.threatDeg !== undefined ? { allRound: false, bearingDeg: over.threatDeg } : resolveThreat(o, this._opts.footprint.bearingDeg, centre, this._threatMerc());
    const readFor = over.readFor ?? ip.readFor;
    const moveDeg = thr.allRound ? null : readFor === 'defence' ? (thr.bearingDeg + 180) % 360 : thr.bearingDeg;
    const mover: IpbMover = over.mover ?? (ip.mover !== 'auto' ? ip.mover : readFor === 'defence' ? 'armour' : ipbMoverOf(this._activeProfile ?? this._lastArmedProfile ?? 'dismounted', this._ipbRules));
    const month = over.month ?? resolveMonth(this._opts.going.month);
    const season = over.season ?? ip.season;
    const avlbSpanM = over.avlbSpanM ?? ip.avlbSpanM;
    const box: [number, number, number, number] = [Math.round(cx - grid.px0 - rPx), Math.round(cy - grid.py0 - rPx), Math.round(cx - grid.px0 + rPx), Math.round(cy - grid.py0 + rPx)];
    const key = [Math.round(centre[0]), Math.round(centre[1]), radiusM, grid.px0, grid.py0, grid.w, grid.h, grid.pending ? this._extTick : 'done', moveDeg ?? 'all', mover, month, season, avlbSpanM, ip.paint].join('|');
    if (this._ipbLast?.key === key && this._ipbLast.grid === grid) {
      const c = this._ipbLast.coding;
      return { coding: c, grid, key, extent: this._ipbExtent(grid, c, z, ts) };
    }
    const coding = codeIpb({ grid, rules: this._ipbRules, mover, moveDeg, month, lonLat: [lon, lat], avlbSpanM, season, box });
    return { coding, grid, key, extent: this._ipbExtent(grid, coding, z, ts) };
  }

  /** The coding's cells edge to edge in Web Mercator: [xmin, ymin, xmax, ymax]. */
  private _ipbExtent(grid: OcokaGrid, c: IpbCoding, z: number, ts: number): [number, number, number, number] {
    const tl = pxToMerc(grid.px0 + c.x0, grid.py0 + c.y0, z, ts);
    const br = pxToMerc(grid.px0 + c.x0 + c.w, grid.py0 + c.y0 + c.h, z, ts);
    return [tl[0], br[1], br[0], tl[1]];
  }

  /**
   * The IPB coding round a point for a host (works with F off too): the area's shares, what decided them, what the
   * bundle cannot tell, and the reasons at the point itself. Waits for the tiles.
   */
  async ipbCodingAround(
    point: any,
    opts: { radiusKm?: number; mover?: IpbMover; readFor?: 'defence' | 'attack'; month?: number; season?: 'coding' | 'notes'; avlbSpanM?: number; threatDeg?: number } = {},
  ): Promise<{ summary: string; stats: IpbStats; reasons: IpbReason[]; mover: IpbMover; moveDeg: number | null; ms: number } | null> {
    const ll = this._lngLatOf(point);
    if (!ll || !this._cache || !this._manifest) return null;
    const at = lngLatToMercator(ll[0], ll[1]) as MercXY;
    this._ipbCode(at, opts); // asks for the tiles
    await this._tilesSettled(10000);
    this._extTick++;
    const r = this._ipbCode(at, opts);
    if (!r) return null;
    const z = this._manifest.zoom.max;
    const [px, py] = mercToPx(at[0], at[1], z, this._manifest.tileSize);
    const c = r.coding;
    const reasons = ipbReasonsAt(c, this._ipbRules, Math.floor(px - r.grid.px0 - c.x0), Math.floor(py - r.grid.py0 - c.y0));
    return { summary: ipbSummaryText(c), stats: c.stats, reasons, mover: c.mover, moveDeg: c.moveDeg, ms: c.ms };
  }

  /** Why the IPB overlay on the map codes the ground at a point as it does (null when it is not shown or the point is outside). */
  ipbReasonAt(point: any): IpbReason[] | null {
    const last = this._ipbLast;
    const ll = this._lngLatOf(point);
    if (!last || !ll || !this._manifest) return null;
    const at = lngLatToMercator(ll[0], ll[1]);
    const [px, py] = mercToPx(at[0], at[1], this._manifest.zoom.max, this._manifest.tileSize);
    const c = last.coding;
    const bx = Math.floor(px - last.grid.px0 - c.x0);
    const by = Math.floor(py - last.grid.py0 - c.y0);
    if (bx < 0 || by < 0 || bx >= c.w || by >= c.h) return null;
    return ipbReasonsAt(c, this._ipbRules, bx, by);
  }

  // ── IPB avenues of approach (extended.ipb.apchs; IPB_Plan.md §6.2) ───────────────────────────────────────────────────

  /** Worked out only while the Extended View is on, the guide active and the product on. */
  private _apchOn(): boolean {
    return this._ext && this._enabled && this._manifest !== null && this._opts.mode !== 'off' && this._opts.extended.ipb.apchs;
  }

  /** The HQ row that reads for a symbol (book p 7): Bn and smaller with the Bde HQ row over the Bn area (no Bn row in the book). */
  private _apchHq(sidc: string | null, over?: 'bde' | 'div'): { hq: 'bde' | 'div'; frame: 'bn' | 'bde' | 'div'; note: string | null } {
    const want = over ?? this._opts.extended.ipb.hq;
    if (want !== 'auto') return { hq: want, frame: want, note: null };
    const code = echelonCodeOf(sidc);
    const n = code ? Number(code) : NaN;
    if (!Number.isFinite(n)) return { hq: 'bde', frame: 'bde', note: null };
    if (n <= 16) return { hq: 'bde', frame: 'bn', note: 'No Bn HQ row in the book or ATP: the Bde HQ row over the Bn area' };
    if (n <= 18) return { hq: 'bde', frame: 'bde', note: null };
    return { hq: 'div', frame: 'div', note: null };
  }

  /**
   * The area read for a spot: the HQ's frame facing the threat, its anchor snapped to a quarter of its frontage (so a
   * new area is read only when the spot moves that far), and the key of everything the reading depends on.
   */
  private _apchFrame(at: MercXY, sidc: string | null, over: { hq?: 'bde' | 'div'; readFor?: 'defence' | 'attack'; threatDeg?: number; mover?: IpbMover; month?: number } = {}) {
    const o = this._opts.extended;
    const ip = o.ipb;
    const D: any = IPB_DOCTRINE;
    const { hq, frame: fk, note } = this._apchHq(sidc, over.hq);
    const row = D.corridors.hqRows[hq];
    const F = D.corridors.frames[fk];
    const mcWidthM: number = D.corridors.widthM[row.mcWidth];
    const spacingM: number = D.corridors.maxSpacingM[row.spacing];
    const thr = over.threatDeg !== undefined ? { allRound: false, bearingDeg: over.threatDeg } : resolveThreat(o, this._opts.footprint.bearingDeg, at, this._threatMerc());
    const readFor = over.readFor ?? ip.readFor;
    const side: 'enemy' | 'own' = readFor === 'defence' ? 'enemy' : 'own';
    const mover: IpbMover = over.mover ?? (ip.mover !== 'auto' ? ip.mover : readFor === 'defence' ? 'armour' : ipbMoverOf(this._activeProfile ?? this._lastArmedProfile ?? 'dismounted', this._ipbRules));
    const month = over.month ?? resolveMonth(this._opts.going.month);
    const k = Math.cosh(at[1] / 6378137); // Web Mercator metres per ground metre here
    const snap = (F.w / 4) * k;
    const anchor: MercXY = [Math.round(at[0] / snap) * snap, Math.round(at[1] / snap) * snap];
    const tb = (thr.bearingDeg * Math.PI) / 180;
    const T: MercXY = [Math.sin(tb), Math.cos(tb)];
    const axisDeg = side === 'enemy' ? (thr.bearingDeg + 180) % 360 : thr.bearingDeg;
    const ab = (axisDeg * Math.PI) / 180;
    const A: MercXY = [Math.sin(ab), Math.cos(ab)];
    const Rr: MercXY = [Math.cos(ab), -Math.sin(ab)];
    const lengthM = F.fwd + F.lead + F.rear;
    const start: MercXY = side === 'enemy' ? [anchor[0] + T[0] * (F.fwd + F.lead) * k, anchor[1] + T[1] * (F.fwd + F.lead) * k] : [anchor[0] - T[0] * F.rear * k, anchor[1] - T[1] * F.rear * k];
    const pt = (aM: number, qM: number): MercXY => [start[0] + (A[0] * aM + Rr[0] * qM) * k, start[1] + (A[1] * aM + Rr[1] * qM) * k];
    const corners: MercXY[] = [pt(0, -F.w / 2), pt(0, F.w / 2), pt(lengthM, F.w / 2), pt(lengthM, -F.w / 2)];
    const tAt = this._threatMerc();
    const ech = echelonCodeOf(sidc);
    const key = [hq, fk, side, Math.round(anchor[0]), Math.round(anchor[1]), thr.allRound ? 'all' : Math.round(thr.bearingDeg), o.sectorDeg, mover, month, ip.season, ip.avlbSpanM, this._opts.bundleUrl, ech ?? ''].join('|');
    return { hq, fk, note, row, F, mcWidthM, spacingM, thr, side, mover, month, anchor, start, axisDeg, lengthM, corners, k, key, ech: ech ? (ECH_SHORT[ech] ?? null) : null, threatAssumed: !(o.threat === 'point' && tAt) && over.threatDeg === undefined };
  }

  /**
   * The reading for a spot from the tiles in memory (asks for the missing ones): the frame coded by the book's criteria,
   * the corridors and avenues in it, in Web Mercator. 'pending' while a tile is on its way; null when the bundle cannot.
   */
  private _apchCompute(at: MercXY, sidc: string | null, over: Parameters<GroundGuide['_apchFrame']>[2] = {}): { key: string; view: IpbApchView; coding: IpbCoding | null; grid: OcokaGrid | null; extent: [number, number, number, number] | null; cframe: IpbFrame | null; cargs?: any } | 'pending' | null {
    const m = this._manifest;
    const cache = this._cache;
    const L = this._sectionLayers();
    if (!m || !cache || !L.elevHi || !L.elevLo) return null;
    const fr = this._apchFrame(at, sidc, over);
    const base = {
      key: fr.key,
      side: fr.side,
      hq: fr.hq,
      hqLabel: fr.row.label,
      hqNote: fr.note,
      forEch: fr.ech,
      aaFor: fr.row.aaFor,
      mcFor: fr.row.mcFor,
      mcWidthM: fr.mcWidthM,
      spacingM: fr.spacingM,
      mover: fr.mover,
      axisDeg: fr.axisDeg,
      frame: fr.corners,
      frameKm: [fr.F.w / 1000, fr.lengthM / 1000] as [number, number],
      anchor: fr.anchor,
      threatAssumed: fr.threatAssumed,
    };
    if (fr.thr.allRound) {
      const view: IpbApchView = { ...base, frame: [], aas: [], mcs: [], crossovers: [], notes: ['All round threat: the avenues need a direction. [ ] turn the threat, or drag the Threat marker.'], ways: [], codingText: '', ms: { coding: 0, corridors: 0 } };
      return { key: fr.key, view, coding: null, grid: null, extent: null, cframe: null };
    }
    const z = m.zoom.max;
    const ts = m.tileSize;
    const lat = mercatorToLngLat(fr.anchor[0], fr.anchor[1])[1];
    const res = mPerPx(lat, z, ts);
    const padPx = (fr.mcWidthM + 1200) / res + 4;
    const pxs = fr.corners.map((p) => mercToPx(p[0], p[1], z, ts));
    const x0 = Math.min(...pxs.map((p) => p[0])) - padPx, x1 = Math.max(...pxs.map((p) => p[0])) + padPx;
    const y0 = Math.min(...pxs.map((p) => p[1])) - padPx, y1 = Math.max(...pxs.map((p) => p[1])) + padPx;
    const profile = this._legendProfile();
    // Buildings too when the fire on the avenues is read: sight counts them as a chance (as the Extended View does).
    const withBld = this._opts.extended.ipb.fire && !!L.bld;
    const layers = { cls: this._layerNames(profile).cls, elevHi: L.elevHi, elevLo: L.elevLo, bld: withBld ? L.bld : null };
    const n = 2 ** z;
    const want = [layers.cls, layers.elevHi, layers.elevLo, ...(layers.bld ? [layers.bld] : [])];
    for (let ty = Math.max(0, Math.floor(y0 / ts)); ty <= Math.min(n - 1, Math.floor(y1 / ts)); ty++)
      for (let tx = Math.max(0, Math.floor(x0 / ts)); tx <= Math.min(n - 1, Math.floor(x1 / ts)); tx++) for (const layer of want) cache.request(layer, z, tx, ty);
    const peek = (layer: string, x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? null : cache.peek(layer, z, x, y));
    const grid = buildGridRect(peek, layers, z, ts, lat, x0, y0, x1, y1);
    if (grid.pending) return 'pending';
    const ip = this._opts.extended.ipb;
    const [lon] = mercatorToLngLat(fr.anchor[0], fr.anchor[1]);
    // The coding's arguments are kept: the situation template codes the same box again for its other movers.
    const cargs = { grid, rules: this._ipbRules, moveDeg: fr.axisDeg, month: fr.month, lonLat: [lon, lat] as [number, number], avlbSpanM: ip.avlbSpanM, season: ip.season, box: [Math.floor(x0 - grid.px0), Math.floor(y0 - grid.py0), Math.ceil(x1 - grid.px0), Math.ceil(y1 - grid.py0)] as [number, number, number, number] };
    const coding = codeIpb({ ...cargs, mover: fr.mover });
    const [sx, sy] = mercToPx(fr.start[0], fr.start[1], z, ts);
    const cframe: IpbFrame = { sx: sx - grid.px0 - coding.x0, sy: sy - grid.py0 - coding.y0, axisDeg: fr.axisDeg, lengthM: fr.lengthM, widthM: fr.F.w };
    const r = findCorridors({
      coding,
      frame: cframe,
      mcWidthM: fr.mcWidthM,
      spacingM: fr.spacingM,
      sectorDeg: this._opts.extended.sectorDeg,
    });
    const toM = (x: number, y: number): MercXY => pxToMerc(grid.px0 + coding.x0 + x, grid.py0 + coding.y0 + y, z, ts);
    const pairs = (f: Float32Array): MercXY[] => {
      const out: MercXY[] = [];
      for (let i = 0; i + 1 < f.length; i += 2) out.push(toM(f[i], f[i + 1]));
      return out;
    };
    const tol = 2 * res * fr.k;
    const firstViable = r.aas.find((a) => a.viable)?.id ?? null;
    const step = Math.max(1, Math.round(250 / r.stepM));
    const aas: IpbApchAa[] = r.aas.map((a) => {
      const line = simplifyLine(pairs(a.line), tol);
      let len = 0;
      for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const main = a.viable && a.id === firstViable;
      const arrow = a.viable && len > 0 ? attackArrow(line, arrowTail(a.lengthM, a.drawWidthM, fr.spacingM), main) : { fill: [], stroke: [], inner: [] };
      const widthM: number[] = [], alongM: number[] = [];
      for (let i = 0; i < a.widthM.length; i += step) {
        widthM.push(Math.round(a.widthM[i]));
        alongM.push(Math.round(a.alongM[i]));
      }
      return {
        id: a.id,
        rank: a.rank,
        viable: a.viable,
        main,
        open: a.open,
        line,
        arrow,
        widthM,
        alongM,
        lengthM: a.lengthM,
        startM: a.startM,
        endM: a.endM,
        stopped: a.stopped,
        coverPct: a.coverPct,
        twoPct: a.twoPct,
        onePct: a.onePct,
        goPct: a.goPct,
        medianWidthM: a.medianWidthM,
        minWidthM: a.minWidthM,
        narrows: a.narrows.map((q) => ({ at: toM(q.x, q.y), alongM: q.alongM, widthM: q.widthM, kind: q.kind })),
        waterLines: a.waterLines,
        why: a.why,
        sideM: a.sideM,
        mcs: a.mcs,
      };
    });
    const view: IpbApchView = {
      ...base,
      aas,
      mcs: r.mcs.map((q) => ({ id: q.id, aa: q.aa, line: simplifyLine(pairs(q.line), tol) })),
      crossovers: r.crossovers.map((x) => ({ id: x.id, a: x.a, b: x.b, from: toM(x.from[0], x.from[1]), to: toM(x.to[0], x.to[1]), alongM: x.alongM, depthM: x.depthM })),
      notes: [...r.notes, ...(fr.note ? [fr.note] : [])],
      ways: r.ways,
      codingText: ipbSummaryText(coding),
      ms: { coding: coding.ms, corridors: r.ms },
    };
    const extent = this._ipbExtent(grid, coding, z, ts);
    view.raster = this._apchRaster(coding, extent);
    return { key: fr.key, view, coding, grid, extent, cframe, cargs };
  }

  /** Where the avenues are wanted (the spot read, its symbol): worked out again only when that changes the area or its key. */
  private _apchAsk(at: MercXY, sidc: string | null): void {
    if (!this._apchOn()) return;
    this._apchWant = { at, sidc };
    if (this._apch && this._apch.key === this._apchFrame(at, sidc).key && !this._apchWaiting) {
      this._apchDraw(); // the same area (back on the map after a drop: its show key keeps it from redrawing otherwise)
      this._ipbFireSoon(350); // only the fire again if the Posns or the spot moved (its key decides)
      return;
    }
    this._apchSoon(300);
  }

  private _apchSoon(ms: number): void {
    if (this._apchTimer !== null) clearTimeout(this._apchTimer);
    this._apchTimer = setTimeout(() => {
      this._apchTimer = null;
      try {
        this._apchRead();
      } catch (err) {
        console.error('[Ground Guide] IPB avenues', err);
      }
    }, ms);
  }

  /** Work the avenues out for the spot wanted (else the map centre) and draw them; once per area. */
  private _apchRead(): void {
    if (!this._apchOn()) return this._apchClear();
    const view: any = this._getView?.();
    const want = this._apchWant ?? (view?.center && Number.isFinite(view.center.x) ? { at: [view.center.x, view.center.y] as MercXY, sidc: null } : null);
    if (!want) return;
    const key = this._apchFrame(want.at, want.sidc).key;
    if (this._apch && this._apch.key === key) {
      this._apchWaiting = false;
      return this._apchDraw();
    }
    const t0 = performance.now();
    const r = this._apchCompute(want.at, want.sidc);
    if (r === 'pending') {
      this._apchWaiting = true; // tiles on their way: read again when they arrive (the last area stays drawn meanwhile)
      return;
    }
    this._apchWaiting = false;
    if (!r) return this._apchClear();
    this._apch = { key: r.key, view: r.view, coding: r.coding, grid: r.grid, extent: r.extent, cframe: r.cframe, cargs: r.cargs };
    this._tplCodes = null;
    const v = r.view;
    const viable = v.aas.filter((a) => a.viable);
    if (v.aas.length || v.notes.length) {
      EngineLogger.success(
        ENGINE,
        `IPB ${v.side === 'enemy' ? 'en' : 'own'} Apchs for a ${v.aaFor} (${v.hqLabel}, ${v.frameKm[0]} x ${v.frameKm[1]} km): ${viable.length ? viable.map((a) => `${a.id} ${Math.round(a.goPct)} % GO${a.narrows.length ? `, ${a.narrows.length} narrows` : ''}`).join('; ') : v.notes[0] ?? 'none'} · ${Math.round(performance.now() - t0)} ms`,
      );
    }
    this._emit('ground-guide-ipb-apchs', { side: v.side, hq: v.hq, aaFor: v.aaFor, mcFor: v.mcFor, avenues: v.aas.map((a) => ({ id: a.id, viable: a.viable, goPct: a.goPct, narrows: a.narrows.length, lengthM: a.lengthM })), notes: v.notes, ms: v.ms });
    this._apchDraw();
    this._fireKey = '';
    this._ipbFireSoon(30); // fire on the avenues and the proforma follow the new area
    if (this._extOverlayKind() === 'ipb') this._extOverlaySoon(0); // the coding now paints the whole area read
    this._refreshLive();
    this._scopeSoon(0, true);
  }

  private _apchDraw(): void {
    const a = this._apch;
    if (!a || !this._apchOn() || !this._extHere()) return this._apchMap.clear(); // on the map only while placing (or held)
    const ip = this._opts.extended.ipb;
    this._apchMap.show(a.view, { corridors: ip.mapCorridors, labels: ip.labels, fire: ip.fire && ip.mapFire, decision: ip.decision && ip.mapDecision, air: ip.air && ip.mapAir, template: ip.template !== 'off' && ip.mapTemplate }, `${a.key}|${ip.mapCorridors}|${ip.labels}|${ip.fire && ip.mapFire ? this._fireKey : ''}|${a.view.fire ? 1 : 0}|${ip.decision && ip.mapDecision ? this._fireKey : ''}|${a.view.decision ? 1 : 0}|${ip.air && ip.mapAir ? this._fireKey : ''}|${a.view.air ? 1 : 0}|${ip.template !== 'off' && ip.mapTemplate ? this._fireKey : ''}|${a.view.template ? 1 : 0}`);
  }

  private _apchClear(): void {
    if (this._apchTimer !== null) clearTimeout(this._apchTimer);
    this._apchTimer = null;
    this._apch = null;
    this._apchWant = null;
    this._apchWaiting = false;
    this._apchMap.clear();
    if (this._fireTimer !== null) clearTimeout(this._fireTimer);
    if (this._otherTimer !== null) clearTimeout(this._otherTimer);
    this._fireTimer = this._otherTimer = null;
    this._fireKey = '';
    this._apchOther = null;
    this._pfInputs = [];
    this._tplCodes = null;
  }

  /** The reading the cards show: undefined when the product is off, null while it is worked out. */
  private _apchViewNow(): IpbApchView | null | undefined {
    return this._apchOn() ? (this._apch?.view ?? null) : undefined;
  }

  /** The coding as a small picture for the Detail (worst class wins in each pixel), with its extent. */
  private _apchRaster(c: IpbCoding, extent: [number, number, number, number]): { url: string; extent: [number, number, number, number] } | null {
    if (typeof document === 'undefined' || !c.w || !c.h) return null;
    const f = Math.max(1, Math.ceil(Math.max(c.w, c.h) / 380));
    const w = Math.ceil(c.w / f), h = Math.ceil(c.h / f);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    // Rank: NO-GO 4 > SLOW-GO 3 > not classed 2 > not assessed 1 > GO / no data 0.
    const RANK = [0, 3, 4, 1, 2];
    const COL: Array<[number, number, number, number]> = [[0, 0, 0, 0], [195, 203, 211, 70], [185, 162, 232, 90], [238, 138, 31, 110], [229, 72, 77, 150]];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let best = 0;
        for (let v = 0; v < f && y * f + v < c.h; v++)
          for (let u = 0; u < f && x * f + u < c.w; u++) {
            const code = c.code[(y * f + v) * c.w + x * f + u];
            const r = code < RANK.length ? RANK[code] : 0;
            if (r > best) best = r;
          }
        const col = COL[best], o = (y * w + x) * 4;
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = col[3];
      }
    ctx.putImageData(img, 0, 0);
    try {
      return { url: canvas.toDataURL('image/png'), extent };
    } catch {
      return null;
    }
  }

  /** The IPB air avenues, LZ / DZ and AD sites over the area read now (Extended View on, `extended.ipb.air`), or null. */
  ipbAir(): IpbAirView | null {
    return this._apchOn() && this._opts.extended.ipb.air ? (this._apch?.view.air ?? null) : null;
  }

  /** The IPB avenues of approach over the area read now (Extended View on, `extended.ipb.apchs`), or null. */
  ipbApproaches(): IpbApchView | null {
    return this._apchViewNow() ?? null;
  }

  /**
   * The IPB corridors and avenues for a host at any point (works with F off too): the HQ's area facing the threat,
   * coded by the book, with its avenues, corridors, narrows and crossovers in Web Mercator. Waits for the tiles.
   */
  async ipbApproachesAround(point: any, opts: { sidc?: string | null; hq?: 'bde' | 'div'; readFor?: 'defence' | 'attack'; threatDeg?: number; mover?: IpbMover; month?: number } = {}): Promise<IpbApchView | null> {
    const ll = this._lngLatOf(point);
    if (!ll || !this._cache || !this._manifest) return null;
    const at = lngLatToMercator(ll[0], ll[1]) as MercXY;
    const over = { hq: opts.hq, readFor: opts.readFor, threatDeg: opts.threatDeg, mover: opts.mover, month: opts.month };
    let r = this._apchCompute(at, opts.sidc ?? null, over);
    for (let i = 0; r === 'pending' && i < 3; i++) {
      await this._tilesSettled(10000);
      r = this._apchCompute(at, opts.sidc ?? null, over);
    }
    return r && r !== 'pending' ? r.view : null;
  }

  /** How Create on Map makes symbols (SymbolEngine passes loadSymbolFromJSON, run with the removal as one undo step). */
  setCreator(fn: ((items: any[], label: string, removeIds: string[]) => any[]) | null): void {
    this._creator = fn;
  }

  /**
   * The symbols Create on Map writes for one product of the reading shown (IPB_Plan.md §6.8): `coo` the NO-GO and SLOW-GO
   * areas of the area read (No Go Area 25120203 / Slow Go Area 25120202, sharp-edged polygons), `corridors` the mobility
   * corridors (Mob Corridors 25110101 with the corridor unit's echelon), `apchs` the avenues (Main Attk 25151403 for the
   * best going, Sp Attk 25151404 for the others, as drawn; or the Avenue of Apchs 25120204 with `ipb.createAs: avenue`).
   * The enemy's in red (hostile), own and the coding in blue (friend). Items are what SymbolEngine.loadSymbolFromJSON takes.
   */
  ipbSymbols(kind: 'coo' | 'corridors' | 'apchs' | 'event' | 'dst' | 'air' | 'template'): any[] {
    const a = this._apch;
    if (!a || !a.view.aas.length) return [];
    const v = a.view;
    const ip = this._opts.extended.ipb;
    const mp = (p: MercXY) => ({ x: p[0], y: p[1], spatialReference: { wkid: 102100 } });
    const sidc = (key: string, identity: string, echelon = '00') => `100${identity}${key.slice(0, 2)}00${echelon}${key.slice(2)}0000`;
    const side = v.side === 'enemy' ? '6' : '3';
    // A line for a symbol: at most `max` points, simplified within a growing tolerance (50 m first).
    const fewer = (pts: MercXY[], max: number): MercXY[] => {
      let tol = 50 * Math.cosh((pts[0]?.[1] ?? 0) / 6378137);
      let out = simplifyLine(pts, tol);
      while (out.length > max && tol < 1e6) {
        tol *= 1.6;
        out = simplifyLine(pts, tol);
      }
      return out;
    };
    const items: any[] = [];
    if (kind === 'template') {
      // The situation template's elements where the ground lets them be, all as the enemy's (hostile): objectives as Obj
      // Areas (25151700), the FUP as a line square to the avenue (25140302), assembly areas (25150200), bridgeheads as a
      // Bridgehead Line round the box (25141400), units as their unit symbols with the echelon. Crossings: no symbol.
      const tv = v.template;
      if (!tv) return [];
      const k0 = Math.cosh(v.anchor[1] / 6378137);
      const ring = (c: MercXY, r: number, n = 16): MercXY[] => Array.from({ length: n }, (_, i) => [c[0] + Math.sin((i / n) * Math.PI * 2) * r, c[1] + Math.cos((i / n) * Math.PI * 2) * r] as MercXY);
      for (const e of tv.elements) {
        if (!e.key || e.status === 'none') continue;
        const r = e.footM * k0;
        if (e.key === '25151700' || e.key === '25150200') {
          const s = sidc(e.key, '6');
          items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: e.label }, drawEssentials: { SYM_GEO_TYPE: 'Area', DRAW_TYPE: 1, CTRL_PTS: ring(e.at, r).map(mp) } });
        } else if (e.key === '25140302') {
          const b = (e.dirDeg * Math.PI) / 180;
          const q: MercXY = [Math.cos(b), -Math.sin(b)];
          const s = sidc(e.key, '6');
          items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: e.label }, drawEssentials: { SYM_GEO_TYPE: 'Line', CTRL_PTS: [[e.at[0] - q[0] * r, e.at[1] - q[1] * r] as MercXY, [e.at[0] + q[0] * r, e.at[1] + q[1] * r] as MercXY].map(mp) } });
        } else if (e.key === '25141400' && e.box && e.box.length === 4) {
          const s = sidc(e.key, '6');
          items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: e.label }, drawEssentials: { SYM_GEO_TYPE: 'Line', CTRL_PTS: [e.box[0], e.box[3], e.box[2], e.box[1]].map(mp) } });
        } else if (!e.key.startsWith('25')) {
          const s = `1006${e.key.slice(0, 2)}00${e.ech ?? '00'}${e.key.slice(2)}0000`;
          items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: e.label }, drawEssentials: { SYM_GEO_TYPE: 'FPoint', GEOM: mp(e.at) } });
        }
      }
      return items;
    }
    if (kind === 'air') {
      // Air avenues as Low Level Transit Routes (25170200, 600 m wide), LZ (25242304) and DZ (25060000) squares, the AD
      // sites' reach as SHORAD engagement zones (25171900), OPs over the enemy's LZs (25160100). The air avenues and their
      // LZ / DZ are the reading side's colour; the AD against them and the OPs are the other side's.
      const av = v.air;
      if (!av) return [];
      const k0 = Math.cosh(v.anchor[1] / 6378137);
      const other = side === '6' ? '3' : '6';
      for (const r of av.routes) {
        if (r.line.length < 2) continue;
        const pts = fewer(r.line, 8);
        const p0 = pts[0], p1 = pts[1];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        const nx = -(p1[1] - p0[1]) / len, ny = (p1[0] - p0[0]) / len;
        const half = 300 * k0;
        const s = sidc('25170200', side);
        items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: `Air ${r.id}` }, drawEssentials: { SYM_GEO_TYPE: 'Line', CTRL_PTS: pts.slice(1).map(mp), BASE_LN_PTS: { startPt: mp([p0[0] + nx * half, p0[1] + ny * half]), midPt: mp(p0), endPt: mp([p0[0] - nx * half, p0[1] - ny * half]) } } });
      }
      for (const z of [...av.lzs, ...av.dzs]) {
        const s = sidc(z.kind === 'lz' ? '25242304' : '25060000', side);
        items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: z.id }, drawEssentials: { SYM_GEO_TYPE: 'Area', DRAW_TYPE: 2, CTRL_PTS: z.ring.map(mp) } });
      }
      for (const d of av.ad) {
        const ring: MercXY[] = [];
        const r = av.adRangeM * k0;
        for (let i = 0; i < 24; i++) ring.push([d.at[0] + Math.sin((i * Math.PI) / 12) * r, d.at[1] + Math.cos((i * Math.PI) / 12) * r]);
        const s = sidc('25171900', other);
        items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: d.id }, drawEssentials: { SYM_GEO_TYPE: 'Area', DRAW_TYPE: 2, CTRL_PTS: ring.map(mp) } });
      }
      for (const z of av.lzs) {
        if (!z.op) continue;
        const s = sidc('25160100', other);
        items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: `OP ${z.id}` }, drawEssentials: { SYM_GEO_TYPE: 'Point', GEOM: mp(z.op.at) } });
      }
      return items;
    }
    if (kind === 'event' || kind === 'dst') {
      // NAIs (25120200) as round areas, TAIs (25120201) as boxes along the avenue, DPs (25130700) as points: own measures.
      const dv = v.decision;
      if (!dv) return [];
      const k0 = Math.cosh(v.anchor[1] / 6378137);
      if (kind === 'event') {
        const r = Math.max(300, v.mcWidthM / 2) * k0;
        for (const n of dv.nais) {
          const ring: MercXY[] = [];
          for (let i = 0; i < 8; i++) ring.push([n.at[0] + Math.sin((i * Math.PI) / 4) * r, n.at[1] + Math.cos((i * Math.PI) / 4) * r]);
          const s = sidc('25120200', '3');
          items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: String(n.n) }, drawEssentials: { SYM_GEO_TYPE: 'Area', DRAW_TYPE: 1, CTRL_PTS: ring.map(mp) } });
        }
        return items;
      }
      for (const t of dv.tais) {
        const b = (t.dirDeg * Math.PI) / 180;
        const L = Math.max(600, v.mcWidthM * 1.4) * k0, W = Math.max(400, v.mcWidthM) * k0;
        const f: MercXY = [Math.sin(b), Math.cos(b)], q: MercXY = [Math.cos(b), -Math.sin(b)];
        const c = (u: number, w: number): MercXY => [t.at[0] + f[0] * u + q[0] * w, t.at[1] + f[1] * u + q[1] * w];
        const s = sidc('25120201', '3');
        items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: String(t.n) }, drawEssentials: { SYM_GEO_TYPE: 'Area', DRAW_TYPE: 2, CTRL_PTS: [c(-L / 2, -W / 2), c(L / 2, -W / 2), c(L / 2, W / 2), c(-L / 2, W / 2)].map(mp) } });
      }
      // DPs on the ground read; one beyond the area goes where the map shows it (on the way in from the threat, or the edge).
      for (const d of dv.dps) {
        const s = sidc('25130700', '3');
        items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: String(d.n) }, drawEssentials: { SYM_GEO_TYPE: 'Point', GEOM: mp(d.at) } });
      }
      return items;
    }
    if (kind === 'coo') {
      if (!a.coding || !a.grid || !a.cframe || !this._manifest) return [];
      const c = a.coding, g = a.grid, z = this._manifest.zoom.max, ts = this._manifest.tileSize;
      const toM = (x: number, y: number): MercXY => pxToMerc(g.px0 + c.x0 + x, g.py0 + c.y0 + y, z, ts);
      // Patches smaller than a quarter of the corridor width squared do not shape the level read (as for the corridors).
      const minAreaM2 = (v.mcWidthM / 2) ** 2;
      for (const [cls, key] of [['nogo', '25120203'], ['slow', '25120202']] as const) {
        for (const ar of ipbAreas(c, { cls, frame: a.cframe, minAreaM2, maxAreas: cls === 'nogo' ? 80 : 60, maxVerts: 40 })) {
          const s = sidc(key, '3');
          items.push({ sidc: s, amplifier: { SIDC: s }, drawEssentials: { SYM_GEO_TYPE: 'Area', DRAW_TYPE: 2, CTRL_PTS: ar.ring.map(([x, y]) => mp(toM(x, y))) } });
        }
      }
      return items;
    }
    if (kind === 'corridors') {
      const ech = v.mcFor === 'Bn' ? '16' : v.mcFor === 'Bde' ? '18' : '15';
      for (const m of v.mcs) {
        if (m.line.length < 2) continue;
        const s = sidc('25110101', side, ech);
        // No label: the corridors' echelon marks say their level, and A1, A2... would pile up on the avenues' letters.
        items.push({ sidc: s, amplifier: { SIDC: s }, drawEssentials: { SYM_GEO_TYPE: 'Line', ECHELON: ech, CTRL_PTS: fewer(m.line, 6).map(mp) } });
      }
      return items;
    }
    for (const x of v.aas) {
      if (!x.viable || x.line.length < 2) continue;
      const key = ip.createAs === 'avenue' ? '25120204' : x.main ? '25151403' : '25151404';
      const geo = key === '25151404' ? 'Line' : 'Area';
      // The width drawn on the map (corridors side by side), as MainAttack.ts reads TAIL_FACTOR.
      const width = v.mcWidthM * (x.open ? 3 : 2.2);
      const tail = arrowTail(x.lengthM, width, v.spacingM);
      const s = sidc(key, side);
      // The head in proportion to its width, as on the map (a fixed 15 % stretches a long arrow's head into a needle).
      items.push({ sidc: s, amplifier: { SIDC: s, UNIQUE_DESIG: x.id }, drawEssentials: { SYM_GEO_TYPE: geo, TAIL_FACTOR: Number(tail.toFixed(4)), HEAD_RATIO: Number(arrowHeadFrac(tail).toFixed(4)), CTRL_PTS: fewer(x.line, 7).map(mp) } });
    }
    return items;
  }

  /**
   * Create on Map: write the reading shown as ordinary symbols (saved with the plan, exported, edited and undone like any
   * other). Making a product again replaces the set made before (if still on the map), all as one undo step. Returns how
   * many were made per product; nothing when the Extended View has no reading yet.
   */
  createIpbOverlay(kind: 'coo' | 'corridors' | 'apchs' | 'event' | 'dst' | 'decision' | 'air' | 'template' | 'all' = 'all'): { made: number; replaced: number; by: Record<string, number> } {
    const none = { made: 0, replaced: 0, by: {} as Record<string, number> };
    if (!this._creator) return none;
    if (!this._apch || !this._apchOn()) {
      this._badge.flash('Create on Map: turn the Extended View on (F) and let the area be read first', 3000);
      return none;
    }
    const kinds: Array<'coo' | 'corridors' | 'apchs' | 'event' | 'dst' | 'air' | 'template'> = kind === 'all' ? ['coo', 'corridors', 'apchs'] : kind === 'decision' ? ['event', 'dst'] : [kind];
    const items: any[] = [];
    const by: Record<string, number> = {};
    const removeIds: string[] = [];
    const slices: Array<{ k: 'coo' | 'corridors' | 'apchs' | 'event' | 'dst' | 'air' | 'template'; from: number; to: number }> = [];
    for (const k of kinds) {
      const list = this.ipbSymbols(k);
      slices.push({ k, from: items.length, to: items.length + list.length });
      items.push(...list);
      by[k] = list.length;
      removeIds.push(...this._ipbMade[k]);
    }
    if (!items.length) {
      this._badge.flash('Create on Map: nothing to write for this area', 2500);
      return none;
    }
    const NAME = { coo: 'COO', corridors: 'Mob Corridors', apchs: `${this._apch.view.side === 'enemy' ? 'En' : 'Own'} Apchs`, event: 'NAIs', dst: 'TAIs, DPs', air: 'Air', template: 'Template' };
    const label = `IPB: ${kinds.map((k) => NAME[k]).join(', ')}`;
    let made: any[] = [];
    try {
      made = this._creator(items, label, removeIds);
    } catch (err) {
      console.error('[Ground Guide] Create on Map', err);
    }
    for (const sl of slices) this._ipbMade[sl.k] = made.slice(sl.from, sl.to).filter(Boolean).map((g: any) => g?.attributes?.id).filter((id: any): id is string => typeof id === 'string');
    const n = made.filter(Boolean).length;
    EngineLogger.success(ENGINE, `${label}: ${n} symbol${n === 1 ? '' : 's'} created${removeIds.length ? `, ${removeIds.length} made before replaced` : ''} (one undo step)`);
    this._badge.flash(`Created ${n} symbol${n === 1 ? '' : 's'} (${kinds.map((k) => `${NAME[k]} ${by[k]}`).join(', ')}). Ctrl+Z undoes them.`, 3500);
    this._emit('ground-guide-ipb-created', { kind, made: n, by, replaced: removeIds.length });
    return { made: n, replaced: removeIds.length, by };
  }

  // ── IPB fire corridors and proforma (extended.ipb.fire / proforma; IPB_Plan.md §6.3, §6.5) ─────────────────────────

  private _ipbFireOn(): boolean {
    const ip = this._opts.extended.ipb;
    return this._apchOn() && (ip.fire || ip.proforma || ip.decision || ip.air || ip.template !== 'off');
  }

  /** Work the fire on the avenues and the proforma out soon (after a new area, a moved spot or a changed symbol). */
  private _ipbFireSoon(ms: number): void {
    if (!this._ipbFireOn() || !this._apch) return;
    if (this._fireTimer !== null) clearTimeout(this._fireTimer);
    this._fireTimer = setTimeout(() => {
      this._fireTimer = null;
      try {
        this._ipbFireRun();
      } catch (err) {
        console.error('[Ground Guide] IPB fire / proforma', err);
      }
    }, ms);
  }

  /**
   * The Posns of one side inside the area read (with a 1 km margin): land units and equipment on the map with their
   * ranges from the catalogue (`Rng`: anti-armour against an armoured mover, else direct fire; small arms 300 m when
   * none), and, for own Posns, the symbol being placed. At most 16, nearest the area's middle first.
   */
  private _ipbPosns(v: IpbApchView, side: 'own' | 'enemy'): Array<{ at: MercXY; label: string; effM: number; obsM: number; eyeM: number; spot: boolean; assumed: boolean }> {
    const want = side === 'own' ? ['2', '3'] : ['5', '6'];
    const k = Math.cosh(v.anchor[1] / 6378137);
    const xs = v.frame.map((p) => p[0]), ys = v.frame.map((p) => p[1]);
    const pad = 1000 * k;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const armour = v.mover !== 'dismounted';
    const out: Array<{ at: MercXY; label: string; effM: number; obsM: number; eyeM: number; spot: boolean; assumed: boolean }> = [];
    const rngOf = (rng: any): { effM: number; obsM: number; vehicle: boolean; assumed: boolean } => {
      const at3 = Array.isArray(rng?.at) && rng.at[1] > 0 ? Number(rng.at[1]) : null;
      const dir3 = Array.isArray(rng?.dir) && rng.dir[1] > 0 ? Number(rng.dir[1]) : null;
      const w = weaponOf(rng);
      const effM = (armour ? (at3 ?? dir3) : (dir3 ?? at3)) ?? w.effM;
      return { effM, obsM: Math.max(effM, Number(rng?.obs) || Number(rng?.nvObs) || 3000), vehicle: armour && at3 !== null, assumed: at3 === null && dir3 === null && !w.fromSymbol };
    };
    for (const g of this._placedGraphics()) {
      if (g.geometry?.type !== 'point') continue;
      const s = normaliseSidc(graphicSidc(g));
      if (!s || s.length !== 20 || !want.includes(s[3])) continue;
      const set = s.substring(4, 6);
      if (set !== '10' && set !== '15') continue;
      const at = toMercatorShape(g.geometry)?.parts[0]?.[0];
      if (!at || at[0] < x0 || at[0] > x1 || at[1] < y0 || at[1] > y1) continue;
      const ck = catalogKey(s);
      const found = ck ? this._rangeLookup(ck) : null;
      const r = rngOf(found?.rng);
      out.push({ at: [at[0], at[1]], label: found?.name ?? g.attributes?.drawEssentials?.SYM_NAME ?? 'Posn', effM: r.effM, obsM: r.obsM, eyeM: set === '15' || r.vehicle ? 2.4 : 1.6, spot: false, assumed: r.assumed });
    }
    // The symbol being placed is one of own Posns (snapped to 100 m, so a small move does not work it all out again).
    const c = this._extCtx;
    if (side === 'own' && c && this._lastDetail?.sidc) {
      const ck = catalogKey(this._lastDetail.sidc);
      const r = rngOf(ck ? this._rangeLookup(ck)?.rng : null);
      const sn = 100 * k;
      out.push({ at: [Math.round(c.at[0] / sn) * sn, Math.round(c.at[1] / sn) * sn], label: 'This Posn', effM: r.effM, obsM: r.obsM, eyeM: c.reading.eyeM, spot: true, assumed: r.assumed });
    }
    return out.sort((p, q) => Math.hypot(p.at[0] - cx, p.at[1] - cy) - Math.hypot(q.at[0] - cx, q.at[1] - cy)).slice(0, 16);
  }

  /** The fire on one reading's avenues from the other side's Posns. */
  private _ipbFireFor(a: { view: IpbApchView; grid: OcokaGrid }, posnSide: 'own' | 'enemy'): IpbFireView | null {
    const m = this._manifest;
    if (!m) return null;
    const g = a.grid, v = a.view;
    const z = m.zoom.max, ts = m.tileSize;
    const toPx = (p: MercXY): [number, number] => {
      const [px, py] = mercToPx(p[0], p[1], z, ts);
      return [px - g.px0, py - g.py0];
    };
    const toM = (x: number, y: number): MercXY => pxToMerc(x + g.px0, y + g.py0, z, ts);
    const posns = this._ipbPosns(v, posnSide).filter((p) => {
      const [x, y] = toPx(p.at);
      return x >= 2 && y >= 2 && x < g.w - 2 && y < g.h - 2;
    });
    const lines = v.aas.map((aa) => {
      const pts = aa.line.map(toPx);
      const alongM = [aa.startM];
      for (let i = 1; i < pts.length; i++) alongM.push(alongM[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * g.res);
      return { id: aa.id, pts, alongM, narrows: aa.narrows.map((n) => ({ ...(() => { const [x, y] = toPx(n.at); return { x, y }; })(), alongM: n.alongM, widthM: n.widthM, kind: n.kind })) };
    });
    const month = resolveMonth(this._opts.going.month);
    const r = fireCoverage({ grid: g, posns: posns.map((p) => ({ ...(() => { const [x, y] = toPx(p.at); return { x, y }; })(), eyeM: p.eyeM, effM: p.effM, obsM: p.obsM, label: p.label })), lines, tables: sightTables(OCOKA_DOCTRINE, month, g.res), targetM: v.mover === 'dismounted' ? 1.7 : 2.4 });
    return {
      posns: posns.map((p) => ({ at: p.at, label: p.label, effM: p.effM, obsM: p.obsM, spot: p.spot, assumed: p.assumed })),
      lines: r.lines.map((c) => {
        const segs: IpbFireView['lines'][number]['segs'] = [];
        for (const s of c.samples) {
          const last = segs[segs.length - 1];
          const at = toM(s.x, s.y);
          if (last && last.state === s.state) {
            last.toM = s.alongM;
            last.line.push(at);
          } else {
            if (last) last.line.push(at); // the stretches join without a gap
            segs.push({ state: s.state, fromM: s.alongM, toM: s.alongM, line: [at] });
          }
        }
        const aa = v.aas.find((x) => x.id === c.id);
        return { id: c.id, coveredPct: c.coveredPct, screenedPct: c.screenedPct, deadPct: c.deadPct, outPct: c.outPct, seenPct: c.seenPct, gaps: c.gaps, segs, startM: aa?.startM ?? 0, endM: aa?.endM ?? 0, nearestM: c.nearestM, nearestPosn: c.nearestPosn };
      }),
      killing: r.killing.map((k2) => ({ on: k2.on, at: toM(k2.x, k2.y), alongM: k2.alongM, kind: k2.kind, widthM: k2.widthM, lengthM: k2.lengthM, text: k2.text })),
      posnSide,
      ms: r.ms,
    };
  }

  /** What the proforma's rows measure on each avenue of a reading (IpbProforma.ts `PfMeasures`). */
  private _pfMeasuresFor(a: { view: IpbApchView; grid: OcokaGrid }, fire: IpbFireView | null): PfGroupIn['aas'] {
    const m = this._manifest;
    if (!m) return [];
    const g = a.grid, v = a.view;
    const z = m.zoom.max, ts = m.tileSize;
    const D: any = IPB_DOCTRINE;
    const TREES = new Set<number>(D.coding?.vegetation?.classes?.value ?? [1, 29, 30, 31]);
    const BUA = new Set<number>(D.coding?.bua?.classes?.value ?? [3]);
    const HARD = new Set<number>(D.coding?.roads?.hardClasses?.value ?? [34, 35, 36, 37]);
    const toPx = (p: MercXY): [number, number] => {
      const [px, py] = mercToPx(p[0], p[1], z, ts);
      return [px - g.px0, py - g.py0];
    };
    const clsAt = (x: number, y: number): number => {
      const xi = Math.floor(x), yi = Math.floor(y);
      return xi < 0 || yi < 0 || xi >= g.w || yi >= g.h ? 255 : g.cls[yi * g.w + xi];
    };
    // ITG candidates over the whole area, once.
    const xs = v.frame.map((p) => p[0]), ys = v.frame.map((p) => p[1]);
    const centre: MercXY = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const kc = Math.cosh(centre[1] / 6378137);
    const radiusM = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 / kc;
    const cands = this._features ? this._features.candidatesNear(centre, radiusM, 60, 1) : null;
    return v.aas.map((aa) => {
      // Samples every 200 m along the centre line, with the line's direction.
      const pts = aa.line.map(toPx);
      const S: Array<{ x: number; y: number; dx: number; dy: number }> = [];
      const step = 200 / g.res;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (!len) continue;
        for (let t = 0; t < len; t += step) S.push({ x: x0 + ((x1 - x0) * t) / len, y: y0 + ((y1 - y0) * t) / len, dx: (x1 - x0) / len, dy: (y1 - y0) / len });
      }
      // Cover and built-up ground across a band one avenue wide; a metalled road within 300 m.
      const half = ((aa.viable ? (aa.open ? 3 : 2.2) : 1) * v.mcWidthM) / 2 / g.res;
      const roadR = 300 / g.res;
      let all = 0, cover = 0, bua = 0, road = 0;
      for (const s of S) {
        let hasRoad = false;
        for (let q = -Math.max(half, roadR); q <= Math.max(half, roadR); q += 2) {
          const c = clsAt(s.x - s.dy * q, s.y + s.dx * q);
          if (c === 255) continue;
          if (Math.abs(q) <= half) {
            all++;
            if (TREES.has(c) || BUA.has(c)) cover++;
            if (BUA.has(c)) bua++;
          }
          if (Math.abs(q) <= roadR && HARD.has(c)) hasRoad = true;
        }
        if (hasRoad) road++;
      }
      // Radio: 3 m masts 3 km apart along it, on the ground alone.
      let legs = 0, clear = 0;
      const legN = Math.max(1, Math.round(3000 / 200));
      for (let i = 0; i + legN < S.length; i += legN) {
        const p = S[i], q = S[i + legN];
        const r = sightTo(g, p.x, p.y, q.x, q.y, { eyeM: 3, targetM: 3, tolM: 1, tables: null, going: null, effM: 0, radiusM: 0 });
        if (!r) continue;
        legs++;
        if (r.pTerrain >= 0.5) clear++;
      }
      let itg: number | null = null;
      if (cands && !cands.pending) {
        const near = 1000 / g.res;
        itg = cands.list.filter((c) => {
          const [cx2, cy2] = toPx(c.at);
          return S.some((s) => Math.hypot(s.x - cx2, s.y - cy2) <= near);
        }).length;
      }
      const f = fire?.posns.length ? fire.lines.find((l) => l.id === aa.id) : null;
      const measures: PfMeasures = {
        coveredPct: f ? f.coveredPct : null,
        coverPct: all ? (100 * cover) / all : 0,
        obstacles: aa.narrows.length + aa.waterLines,
        itg,
        rooms: aa.viable ? (aa.open ? 3 : 2) : 1,
        medianWidthM: aa.medianWidthM,
        goPct: aa.goPct,
        lengthM: aa.lengthM,
        roadPct: S.length ? (100 * road) / S.length : 0,
        sigsPct: legs ? (100 * clear) / legs : null,
        seenPct: f ? f.seenPct : null,
        buaPct: all ? (100 * bua) / all : 0,
      };
      return { id: aa.id, m: measures };
    });
  }

  /** The proforma from the groups worked out so far and the user's signs. */
  private _pfBuild(): void {
    const a = this._apch;
    if (!a) return;
    const ip = this._opts.extended.ipb;
    if (!ip.proforma || !this._pfInputs.length) {
      a.view.proforma = undefined;
      return;
    }
    const heads = [ip.pfHead1, ip.pfHead2];
    const groups = this._pfInputs.map((g, i) => ({ ...g, head: heads[i]?.trim() || (g.side === 'enemy' ? 'En' : 'Own') }));
    const r = proforma(groups, this._pfUser);
    a.view.proforma = { ...r, pending: this._pfPending };
  }

  /** Fire on the avenues, then the proforma with this side's avenues; the other side's follow a moment later. */
  private _ipbFireRun(): void {
    const a = this._apch;
    if (!a || !a.grid || !this._ipbFireOn()) return;
    const ip = this._opts.extended.ipb;
    const v = a.view;
    const defender: 'own' | 'enemy' = v.side === 'enemy' ? 'own' : 'enemy';
    const posns = this._ipbPosns(v, defender);
    const tAt = this._opts.extended.threat === 'point' ? this._threatMerc() : null;
    const key = `${a.key}|${posns.map((p) => `${Math.round(p.at[0])},${Math.round(p.at[1])},${p.effM}`).join(';')}|${ip.fire}${ip.proforma}${ip.decision}|${ip.reactionH}|${ip.hHour}|${ip.air}${ip.airBand}${ip.lzClass}${ip.lzPoints}|${ip.template}|${tAt ? `${Math.round(tAt[0] / 100)},${Math.round(tAt[1] / 100)}` : ''}`;
    if (key === this._fireKey) return;
    this._fireKey = key;
    if (this._pfArea !== a.key) {
      // A new area: the user's signs and the other side's reading belong to the old one.
      this._pfArea = a.key;
      this._pfUser = {};
      this._apchOther = null;
    }
    const fire = this._ipbFireFor({ view: v, grid: a.grid }, defender);
    v.fire = ip.fire ? fire : undefined;
    v.decision = ip.decision ? this._ipbDecisionFor(a) : undefined;
    v.wx = this._ipbWxFor(v);
    v.air = ip.air ? this._ipbAirFor(a) : undefined;
    v.template = ip.template !== 'off' ? this._ipbTemplateFor(a) : undefined;
    if (ip.proforma) {
      this._pfInputs = [{ head: '', side: v.side, aas: this._pfMeasuresFor({ view: v, grid: a.grid }, fire) }];
      this._pfPending = true;
      this._pfBuild();
      // The other side's avenues over the same area, a moment later (another coding and reading, about half a second).
      if (this._otherTimer !== null) clearTimeout(this._otherTimer);
      this._otherTimer = setTimeout(() => {
        this._otherTimer = null;
        try {
          this._ipbOtherRun();
        } catch (err) {
          console.error('[Ground Guide] IPB proforma, the other side', err);
        }
      }, 60);
    }
    this._ipbFireShown();
  }

  private _ipbOtherRun(): void {
    const a = this._apch;
    if (!a || !this._ipbFireOn() || !this._opts.extended.ipb.proforma) return;
    const want = this._apchWant;
    const at = want?.at ?? a.view.anchor;
    const other: 'defence' | 'attack' = a.view.side === 'enemy' ? 'attack' : 'defence';
    if (!this._apchOther || this._apchOther.area !== a.key) {
      const r = this._apchCompute(at, want?.sidc ?? null, { readFor: other });
      if (r === 'pending') {
        this._otherTimer = setTimeout(() => this._ipbOtherRun(), 400);
        return;
      }
      this._apchOther = r && r.grid ? { area: a.key, view: r.view, grid: r.grid } : null;
    }
    const o = this._apchOther;
    if (o) {
      const fire2 = this._ipbFireFor(o, o.view.side === 'enemy' ? 'own' : 'enemy');
      this._pfInputs = [this._pfInputs[0], { head: '', side: o.view.side, aas: this._pfMeasuresFor(o, fire2) }].filter(Boolean);
    }
    this._pfPending = false;
    this._pfBuild();
    this._ipbFireShown();
  }

  /** Show what changed: the cards, the rail, the map. */
  private _ipbFireShown(): void {
    this._apchDraw();
    this._refreshLive();
    this._scopeSoon(0, true);
  }

  /** A proforma cell was clicked: the suggested sign, then +, −, ?, and back to the suggested one. */
  private readonly _pfClickH = (e: Event): void => {
    const root = this._detail.element;
    if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
    const d = (e as CustomEvent).detail;
    if (!d || typeof d.id !== 'string' || typeof d.row !== 'string' || typeof d.g !== 'number') return;
    const k = pfKey(d.g, d.id, d.row);
    const cur = this._pfUser[k];
    const next: PfSign | undefined = cur === undefined ? '+' : cur === '+' ? '−' : cur === '−' ? '?' : undefined;
    if (next === undefined) delete this._pfUser[k];
    else this._pfUser[k] = next;
    this._pfBuild();
    this._refreshLive();
  };

  // ── IPB rates, event template, decision support, Annex A (extended.ipb.decision; IPB_Plan.md §6.6, §6.7) ─────────────

  /** An avenue's centre line with the distance along it, and the book's going under it every 100 m (from the coding). */
  private _aaAlong(a: { coding: IpbCoding | null; grid: OcokaGrid | null }, aa: IpbApchAa): { pts: Array<{ at: MercXY; alongM: number }>; going: DecAaIn['going'] } {
    const pts: Array<{ at: MercXY; alongM: number }> = [];
    let along = aa.startM;
    aa.line.forEach((p, i) => {
      if (i) {
        const q = aa.line[i - 1];
        along += Math.hypot(p[0] - q[0], p[1] - q[1]) / Math.cosh(((p[1] + q[1]) / 2) / 6378137);
      }
      pts.push({ at: p, alongM: along });
    });
    // The line's length may differ a little from the avenue's own figures: scale to its end.
    const last = pts[pts.length - 1]?.alongM ?? aa.endM;
    const k = last > aa.startM ? (aa.endM - aa.startM) / (last - aa.startM) : 1;
    for (const p of pts) p.alongM = aa.startM + (p.alongM - aa.startM) * k;
    const going: DecAaIn['going'] = [];
    const c = a.coding, g = a.grid, m = this._manifest;
    if (!c || !g || !m) return { pts, going: [{ fromM: aa.startM, toM: aa.endM, cls: 'na' }] };
    const z = m.zoom.max, ts = m.tileSize;
    for (let s = aa.startM; s < aa.endM; s += 100) {
      const at = this._alongAt(pts, s + 50);
      const [px, py] = mercToPx(at[0], at[1], z, ts);
      const x = Math.floor(px - g.px0 - c.x0), y = Math.floor(py - g.py0 - c.y0);
      const code = x >= 0 && y >= 0 && x < c.w && y < c.h ? c.code[y * c.w + x] : IPB.NODATA;
      const cls: DecCls = code === IPB.GO ? 'go' : code === IPB.SLOW || code === IPB.NC ? 'slow' : code === IPB.NOGO ? 'nogo' : 'na';
      const prev = going[going.length - 1];
      if (prev && prev.cls === cls) prev.toM = Math.min(aa.endM, s + 100);
      else going.push({ fromM: s, toM: Math.min(aa.endM, s + 100), cls });
    }
    return { pts, going };
  }

  /** The point at a distance along a line (clamped to its ends). */
  private _alongAt(pts: Array<{ at: MercXY; alongM: number }>, alongM: number): MercXY {
    if (!pts.length) return [0, 0];
    if (alongM <= pts[0].alongM) return pts[0].at;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].alongM >= alongM) {
        const a = pts[i - 1], b = pts[i];
        const t = (alongM - a.alongM) / Math.max(1e-6, b.alongM - a.alongM);
        return [a.at[0] + (b.at[0] - a.at[0]) * t, a.at[1] + (b.at[1] - a.at[1]) * t];
      }
    }
    return pts[pts.length - 1].at;
  }

  /** Rates along each avenue, the event template and decision support for a reading (the enemy's avenues). */
  private _ipbDecisionFor(a: { view: IpbApchView; coding: IpbCoding | null; grid: OcokaGrid | null }): IpbDecisionView {
    const v = a.view;
    const ip = this._opts.extended.ipb;
    const D: any = IPB_DOCTRINE;
    const rates = decRatesFrom(D, v.mover);
    const tAt = this._opts.extended.threat === 'point' ? this._threatMerc() : null;
    const along = new Map<string, ReturnType<GroundGuide['_aaAlong']>>();
    for (const aa of v.aas) along.set(aa.id, this._aaAlong(a, aa));
    // Own depth: the rearmost own Posn beside each avenue (within 3 km of its line), not the symbol being placed.
    const own = v.side === 'enemy' ? this._ipbPosns(v, 'own').filter((p) => !p.spot) : [];
    const depthOf = (id: string): number | null => {
      const L = along.get(id)!.pts;
      let best: number | null = null;
      for (const p of own) {
        let bd = Infinity, ba = 0;
        for (const q of L) {
          const d = Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) / Math.cosh(q.at[1] / 6378137);
          if (d < bd) ((bd = d), (ba = q.alongM));
        }
        if (bd <= 3000 && (best === null || ba > best)) best = ba;
      }
      return best;
    };
    const leadM: Record<string, number> = {};
    for (const aa of v.aas) {
      const p0 = aa.line[0];
      leadM[aa.id] = tAt && p0 ? Math.hypot(p0[0] - tAt[0], p0[1] - tAt[1]) / Math.cosh(p0[1] / 6378137) : 0;
    }
    const catk = v.side !== 'enemy' ? null : v.hqNote ? { label: 'Coy', min: Number(D.decisionPoints?.counterAttack?.coyMin?.value ?? 30) } : v.hq === 'bde' ? { label: 'Bn', min: Number(D.decisionPoints?.counterAttack?.bnMin?.value ?? 60) } : null;
    const r = decide({
      aas: v.aas.map((aa) => ({ id: aa.id, viable: aa.viable, main: aa.main, startM: aa.startM, endM: aa.endM, going: along.get(aa.id)!.going, narrows: aa.narrows.map((n) => ({ alongM: n.alongM, widthM: n.widthM, kind: n.kind })), depthM: depthOf(aa.id) })),
      crossovers: v.crossovers.map((x) => ({ id: x.id, a: x.a, b: x.b, alongM: x.alongM })),
      rates,
      leadM,
      leadH: Number(D.decisionPoints?.interdict?.leadH ?? 2),
      reactionH: ip.reactionH,
      mcWidthM: v.mcWidthM,
      catkMin: catk?.min ?? null,
      catkLabel: catk?.label ?? '',
    });
    const enemy = v.side === 'enemy';
    const dirAt = (pts: Array<{ at: MercXY; alongM: number }>, m: number): number => {
      const a0 = this._alongAt(pts, m - 150), b0 = this._alongAt(pts, m + 150);
      return ((Math.atan2(b0[0] - a0[0], b0[1] - a0[1]) * 180) / Math.PI + 360) % 360;
    };
    const dpAt = (aaId: string, alongM: number): { at: MercXY; inArea: boolean } => {
      const aa = v.aas.find((x) => x.id === aaId)!;
      const pts = along.get(aaId)!.pts;
      if (alongM >= aa.startM) return { at: this._alongAt(pts, alongM), inArea: true };
      const p0 = pts[0].at;
      if (!tAt) return { at: p0, inArea: false };
      const k = Math.cosh(p0[1] / 6378137);
      const d = Math.min(aa.startM - alongM, leadM[aaId]) * k;
      const len = Math.hypot(tAt[0] - p0[0], tAt[1] - p0[1]) || 1;
      return { at: [p0[0] + ((tAt[0] - p0[0]) / len) * d, p0[1] + ((tAt[1] - p0[1]) / len) * d], inArea: false };
    };
    const hh = /^([01]?\d|2[0-3]):([0-5]\d)$/.test(ip.hHour.trim()) ? ip.hHour.trim() : null;
    return {
      rates: { mover: v.mover, go: rates.go, slow: rates.slow, nogo: rates.nogo },
      fromThreat: !!tAt,
      hHour: hh,
      profiles: r.profiles.map((p) => {
        const aa = v.aas.find((x) => x.id === p.aa)!;
        return { aa: p.aa, viable: aa.viable, main: aa.main, pts: p.pts, startAlongM: aa.startM - (leadM[p.aa] ?? 0), startH: p.startH, endH: p.endH };
      }),
      nais: enemy ? r.nais.map((n) => ({ ...n, at: this._alongAt(along.get(n.aa)!.pts, n.alongM) })) : [],
      tais: enemy ? r.tais.map((t) => ({ ...t, at: this._alongAt(along.get(t.aa)!.pts, t.alongM), dirDeg: dirAt(along.get(t.aa)!.pts, t.alongM) })) : [],
      dps: enemy ? r.dps.map((d) => ({ ...d, ...dpAt(d.aa, d.alongM) })) : [],
      catk,
      notes: enemy ? r.notes : ['Decision support reads the enemy\'s avenues: set Read for to Defence. The times over own avenues are shown.'],
    };
  }

  /** Enemy land units already on the map inside the area read, by the kind of mover their symbol says (a template's known positions). */
  private _ipbKnownEnemy(v: IpbApchView): Array<{ at: MercXY; mover: TplMover | 'other'; label: string }> {
    const k = Math.cosh(v.anchor[1] / 6378137);
    const xs = v.frame.map((p) => p[0]), ys = v.frame.map((p) => p[1]);
    const pad = 3000 * k;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const out: Array<{ at: MercXY; mover: TplMover | 'other'; label: string }> = [];
    for (const g of this._placedGraphics()) {
      if (g.geometry?.type !== 'point') continue;
      const s = normaliseSidc(graphicSidc(g));
      if (!s || s.length !== 20 || !['5', '6'].includes(s[3])) continue;
      const set = s.substring(4, 6);
      if (set !== '10' && set !== '15') continue;
      const at = toMercatorShape(g.geometry)?.parts[0]?.[0];
      if (!at || at[0] < x0 || at[0] > x1 || at[1] < y0 || at[1] > y1) continue;
      const ent = s.substring(10, 16);
      const mover: TplMover | 'other' = ent.startsWith('1205') ? 'armour' : ent === '121102' || ent === '121104' || ent.startsWith('1212') ? 'mech' : ent.startsWith('1211') ? 'dismounted' : ent.startsWith('1303') || ent.startsWith('1304') ? 'gun' : 'other';
      const ck = catalogKey(s);
      out.push({ at: [at[0], at[1]], mover, label: (ck ? this._rangeLookup(ck)?.name : null) ?? g.attributes?.drawEssentials?.SYM_NAME ?? 'En' });
    }
    return out;
  }

  /**
   * The situation template over a reading (IPB_Plan.md §6.7; book pp 22-23): the doctrinal template for the reading laid
   * along its avenues, each element judged on its mover's IPB coding (the other movers' codings worked out once per area),
   * moved to the nearest usable ground, known enemy symbols kept where they are; with the template phases and the library.
   */
  private _ipbTemplateFor(a: { key: string; view: IpbApchView; coding: IpbCoding | null; grid: OcokaGrid | null; cargs?: any }): IpbTemplateView | null {
    const m = this._manifest;
    const g = a.grid, c = a.coding, v = a.view;
    if (!m || !g || !c || v.frame.length !== 4) return null;
    const ip = this._opts.extended.ipb;
    const z = m.zoom.max, ts = m.tileSize;
    const toPx = (p: MercXY): [number, number] => {
      const [px, py] = mercToPx(p[0], p[1], z, ts);
      return [px - g.px0 - c.x0, py - g.py0 - c.y0];
    };
    const toM = (x: number, y: number): MercXY => pxToMerc(x + g.px0 + c.x0, y + g.py0 + c.y0, z, ts);
    const readFor: 'defence' | 'attack' = v.side === 'enemy' ? 'defence' : 'attack';
    // Mountains when the ground within 5 km of the position rises 400 m or more (IpbTemplates.json mountainTest, E).
    let mountain = false;
    {
      const [sx, sy] = toPx(v.anchor);
      const r = 5000 / g.res;
      let lo = Infinity, hi = -Infinity;
      const st = Math.max(1, Math.floor(r / 25));
      for (let y = Math.max(0, Math.floor(sy - r)); y < Math.min(c.h, sy + r); y += st)
        for (let x = Math.max(0, Math.floor(sx - r)); x < Math.min(c.w, sx + r); x += st) {
          if ((x - sx) ** 2 + (y - sy) ** 2 > r * r) continue;
          const e = g.elev[(y + c.y0) * g.w + x + c.x0];
          if (e === e) ((lo = Math.min(lo, e)), (hi = Math.max(hi, e)));
        }
      mountain = hi - lo >= Number((IPB_TEMPLATES as any).mountainTest?.riseM ?? 400);
    }
    const spec = pickTemplate(IPB_TEMPLATES, { readFor, hq: v.hq, mountain, want: ip.template });
    if (!spec) return null;
    // Codings: the reading's own, the others once per area.
    const movers = new Set<'armour' | 'mech' | 'dismounted'>();
    for (const e of spec.elements) if (e.mover) movers.add(e.mover === 'gun' ? 'mech' : e.mover);
    if (!this._tplCodes || this._tplCodes.key !== a.key) this._tplCodes = { key: a.key, codes: {} };
    const codes = this._tplCodes.codes;
    codes[v.mover] = c.code;
    for (const mv of movers) {
      if (codes[mv] || !a.cargs) continue;
      try {
        const cc = codeIpb({ ...a.cargs, mover: mv });
        if (cc.w === c.w && cc.h === c.h) codes[mv] = cc.code;
      } catch (err) {
        console.error('[Ground Guide] IPB template coding', mv, err);
      }
    }
    // Avenues in the coding's pixels.
    const aas: TplAa[] = v.aas.map((aa) => {
      const pts = aa.line.map(toPx);
      const alongM = [aa.startM];
      for (let i = 1; i < pts.length; i++) alongM.push(alongM[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * g.res);
      return { id: aa.id, rank: aa.rank, viable: aa.viable, pts, alongM, narrows: aa.narrows.map((n) => { const [x, y] = toPx(n.at); return { x, y, alongM: n.alongM, kind: n.kind }; }) };
    });
    const c2 = v.frame[2], c3 = v.frame[3];
    const endMid: MercXY = [(c2[0] + c3[0]) / 2, (c2[1] + c3[1]) / 2];
    const [ax, ay] = toPx(v.anchor);
    // No avenue (mountains, close country): the template is laid along the threat's direction through the area.
    const axisOnly = !aas.length;
    if (axisOnly) {
      const s0: MercXY = [(v.frame[0][0] + v.frame[1][0]) / 2, (v.frame[0][1] + v.frame[1][1]) / 2];
      const p0 = toPx(s0), p1 = toPx(endMid);
      aas.push({ id: 'axis', rank: 1, viable: false, pts: [p0, p1], alongM: [0, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * g.res], narrows: [] });
    }
    let objective: { x: number; y: number }, depth: { x: number; y: number }, fdl: { x: number; y: number } | null = null;
    if (readFor === 'defence') {
      // The enemy's immediate objective: the position; the subsequent: own depth toward the area's rear edge.
      objective = { x: ax, y: ay };
      const [ex, ey] = toPx(endMid);
      depth = { x: ax + (ex - ax) * 0.6, y: ay + (ey - ay) * 0.6 };
    } else {
      // The enemy's defence: its FDL on the first water crossing of the leading own avenue beyond the spot, else the
      // Threat marker's place, else a third of the way from the spot to the far edge.
      const tAt = this._threatMerc();
      const [ex, ey] = toPx(endMid);
      const lead = aas.find((q) => q.viable) ?? aas[0];
      const aAlong = (() => {
        if (!lead) return 0;
        let best = Infinity, bm = 0;
        lead.pts.forEach((p, i) => {
          const d = Math.hypot(p[0] - ax, p[1] - ay);
          if (d < best) ((best = d), (bm = lead.alongM[i]));
        });
        return bm;
      })();
      const cross = lead?.narrows.filter((n) => n.kind === 'crossing' && n.alongM > aAlong + 1000).sort((p, q) => p.alongM - q.alongM)[0];
      const tp = tAt ? toPx(tAt) : null;
      const inBox = (p: [number, number] | null): p is [number, number] => !!p && p[0] >= 0 && p[1] >= 0 && p[0] < c.w && p[1] < c.h;
      if (cross) fdl = { x: cross.x, y: cross.y };
      else if (inBox(tp)) fdl = { x: tp[0], y: tp[1] };
      else fdl = { x: ax + (ex - ax) / 3, y: ay + (ey - ay) / 3 };
      objective = inBox(tp) ? { x: tp[0], y: tp[1] } : fdl;
      depth = { x: fdl.x + (ex - fdl.x) * 0.6, y: fdl.y + (ey - fdl.y) * 0.6 };
    }
    const known = this._ipbKnownEnemy(v).map((q) => {
      const [x, y] = toPx(q.at);
      return { x, y, mover: q.mover, label: q.label };
    });
    const r = layTemplate({ grid: g, ox: c.x0, oy: c.y0, w: c.w, h: c.h, codes, aas, objective, depth, fdl, known, template: spec, rules: this._tplRules, res: g.res });
    const T: any = IPB_TEMPLATES;
    const confirmed = !(spec.basis === 'D?' || spec.elements.some((e) => e.basis === 'D?') || /Fig [67]/.test(spec.src));
    const ph = spec.kind === 'attack' ? T.phases?.offensive : T.phases?.defensive;
    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      text: spec.text,
      src: spec.src,
      confirmed,
      elements: r.elements.map((e) => ({
        id: e.id,
        label: e.label,
        role: e.role,
        mover: e.mover,
        key: e.key,
        ech: e.ech,
        footM: e.footM,
        basis: e.basis,
        src: e.src,
        doc: e.doc ? toM(e.doc[0], e.doc[1]) : null,
        at: toM(e.x, e.y),
        dirDeg: e.dirDeg,
        status: e.status,
        movedM: e.movedM,
        nogoPct: e.nogoPct,
        why: e.why,
        ...(e.box ? { box: e.box.map(([x, y]) => toM(x, y)) } : {}),
      })),
      moved: r.moved,
      known: r.known,
      outside: r.outside,
      phases: { label: String(ph?.label ?? 'Template phases'), rows: Array.isArray(ph?.rows) ? ph.rows : [] },
      library: templatesFrom(T).map((t) => ({ id: t.id, label: t.label, kind: t.kind, fits: `${t.fits?.readFor === 'defence' ? 'Defence' : 'Own attack'} · ${t.fits?.hq === 'div' ? 'Div HQ' : 'Bde HQ'}${t.fits?.terrain ? ` · ${t.fits.terrain}` : ''}`, basis: t.basis, chosen: t.id === spec.id })),
      auto: ip.template === 'auto',
      notes: [...(axisOnly ? ["No avenue in the area read: the template is laid along the threat's direction."] : []), ...r.notes],
      ms: r.ms,
    };
  }

  /** A template was picked in the Detail's library (or Auto / Off): kept in the settings, the reading follows. */
  private readonly _tplPickH = (e: Event): void => {
    const root = this._detail.element;
    if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
    const id = (e as CustomEvent).detail?.id;
    if (typeof id !== 'string') return;
    const ids = ['auto', 'off', ...templatesFrom(IPB_TEMPLATES).map((t) => t.id)];
    if (!ids.includes(id)) return;
    this.setOptions({ extended: { ...this._opts.extended, ipb: { ...this._opts.extended.ipb, template: id } } });
    setSetting(['groundGuide', 'extended', 'ipb', 'template'], id);
    this._fireKey = '';
    this._ipbFireSoon(0);
  };

  /**
   * Air avenues, LZ / DZ and AD sites over a reading's area (IPB_Plan.md §6.4; GroundGuideIpbAir.ts), in Web Mercator.
   * The enemy's (defence): into own depth behind the spot, watched by own Posns. Own (attack): to the objective (the
   * Threat marker's place, else the middle of the enemy's side), watched by the enemy's Posns and the Threat marker.
   */
  private _ipbAirFor(a: { view: IpbApchView; grid: OcokaGrid | null }): IpbAirView | null {
    const m = this._manifest;
    const g = a.grid, v = a.view;
    if (!m || !g || v.frame.length !== 4) return null;
    const ip = this._opts.extended.ipb;
    const R = this._airRules;
    const z = m.zoom.max, ts = m.tileSize;
    const toPx = (p: MercXY): [number, number] => {
      const [px, py] = mercToPx(p[0], p[1], z, ts);
      return [px - g.px0, py - g.py0];
    };
    const toM = (x: number, y: number): MercXY => pxToMerc(x + g.px0, y + g.py0, z, ts);
    const k = Math.cosh(v.anchor[1] / 6378137);
    const [c0, c1] = v.frame;
    const startMid: MercXY = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2];
    const [sx, sy] = toPx(startMid);
    const lengthM = v.frameKm[1] * 1000, widthM = v.frameKm[0] * 1000;
    const ab = (v.axisDeg * Math.PI) / 180;
    const anchorAlong = ((v.anchor[0] - startMid[0]) * Math.sin(ab) + (v.anchor[1] - startMid[1]) * Math.cos(ab)) / k;
    const enemy = v.side === 'enemy';
    // The other side's eyes.
    const observers = this._ipbPosns(v, enemy ? 'own' : 'enemy').map((p) => {
      const [x, y] = toPx(p.at);
      return { x, y, eyeM: p.eyeM, reachM: Math.max(p.obsM, 5000), label: p.label };
    });
    const tAt = this._threatMerc();
    if (!enemy && tAt) {
      const [x, y] = toPx(tAt);
      observers.push({ x, y, eyeM: 2, reachM: 6000, label: 'Threat' });
    }
    // Features over the area: vertical obstructions, lines to fly along or wires to cross, existing helipads and airfields.
    const xs = v.frame.map((p) => p[0]), ys = v.frame.map((p) => p[1]);
    const centre: MercXY = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const radiusM = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 / k + 500;
    const F = this._features;
    const sc = F ? F.sceneNear(centre, radiusM) : null;
    this._airFeaturesPending = !!sc?.pending;
    const obstructions: AirObstruction[] = [], existing: AirExisting[] = [], lines: AirLine[] = [];
    const exKinds = new Set(R.existingKinds);
    const inG = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < g.w && y < g.h;
    for (const p of sc?.points ?? []) {
      const [x, y] = toPx([p.x, p.y]);
      if (!inG(x, y)) continue;
      const label = F!.kindLabel(p.key);
      if (R.pointH[p.key] !== undefined) {
        const hm = Number(p.a.hm);
        obstructions.push({ x, y, kind: p.key, label, heightM: Number.isFinite(hm) && hm > 0 ? hm : null });
      } else if (exKinds.has(p.key)) existing.push({ x, y, kind: p.key, label, name: tidyName(p.a.n, label) });
    }
    const NAV = new Set(['river', 'canal', 'railway']);
    for (const l of sc?.lines ?? []) {
      const wire = R.lineH[l.key] !== undefined;
      const road = l.key === 'road' && !!(l.a.r || l.a.m);
      if (!wire && !road && !NAV.has(l.key)) continue;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i + 1 < l.xy.length; i += 2) pts.push(toPx([l.xy[i], l.xy[i + 1]]));
      if (pts.length < 2 || !pts.some(([x, y]) => inG(x, y))) continue;
      lines.push({ kind: l.key, name: tidyName(l.a.n, F!.kindLabel(l.key)) ?? (l.a.r ? String(l.a.r) : null), pts });
    }
    const lzZone = enemy ? { fromM: Math.max(0, anchorAlong - 1000), toM: lengthM } : { fromM: Math.min(lengthM - 1500, anchorAlong + 2000), toM: lengthM };
    let objective: { x: number; y: number };
    if (enemy) {
      const [x, y] = toPx(v.anchor);
      objective = { x, y };
    } else if (tAt) {
      const [x, y] = toPx(tAt);
      objective = { x, y };
    } else {
      const al = (anchorAlong + lengthM) / 2;
      const [x, y] = toPx([startMid[0] + Math.sin(ab) * al * k, startMid[1] + Math.cos(ab) * al * k]);
      objective = { x, y };
    }
    const month = resolveMonth(this._opts.going.month);
    const r = airIpb({
      grid: g,
      rules: R,
      frame: { sx, sy, axisDeg: v.axisDeg, lengthM, widthM },
      band: ip.airBand,
      lzClass: ip.lzClass,
      lzPoints: ip.lzPoints,
      observers,
      obstructions,
      lines,
      existing,
      lzZone,
      // AD against the air avenues sits on the defender's side: own ground from 6 km forward of the spot (the enemy's air
      // avenues), the enemy's ground from 1 km beyond it (own air avenues).
      adZone: enemy ? { fromM: Math.max(0, anchorAlong - 6000), toM: lengthM } : { fromM: Math.min(lengthM - 1000, anchorAlong + 1000), toM: lengthM },
      objective,
      tables: sightTables(OCOKA_DOCTRINE, month, g.res),
      enemyLz: enemy,
    });
    const zone = (q: AirLz): IpbAirZone => {
      const hw = q.sideM / 2 / g.res, hl = q.lengthM / 2 / g.res;
      return {
        id: q.id,
        kind: q.kind,
        rank: q.rank,
        at: toM(q.x, q.y),
        ring: [toM(q.x - hw, q.y - hl), toM(q.x + hw, q.y - hl), toM(q.x + hw, q.y + hl), toM(q.x - hw, q.y + hl)],
        sideM: q.sideM,
        lengthM: q.lengthM,
        points: q.points,
        slopeDeg: q.slopeDeg,
        mountain: q.mountain,
        caution: q.caution,
        seenP: q.seenP,
        distObjM: q.distObjM,
        approaches: q.approaches,
        existing: q.existing,
        why: q.why,
        op: q.op ? { at: toM(q.op.x, q.op.y), distM: q.op.distM, riseM: q.op.riseM } : null,
      };
    };
    const inFrameM = (p: MercXY): boolean => {
      const dx = (p[0] - startMid[0]) / k, dy = (p[1] - startMid[1]) / k;
      const al = dx * Math.sin(ab) + dy * Math.cos(ab), ac = dx * Math.cos(ab) - dy * Math.sin(ab);
      return al >= 0 && al <= lengthM && Math.abs(ac) <= widthM / 2;
    };
    const notes: string[] = [];
    if (!F) notes.push('The bundle has no features: no masts, power lines, rivers or existing helipads read.');
    else if (sc?.pending) notes.push('Feature tiles still loading: obstructions and existing helipads may be missing (read again when they arrive).');
    const band = R.bands[ip.airBand];
    return {
      side: v.side,
      band: ip.airBand,
      bandLabel: band.label,
      bandM: r.bandM,
      lzClass: ip.lzClass,
      lzPoints: r.lzPoints,
      lpM: R.lpSizeM[ip.lzClass] ?? 80,
      lzSideM: r.lzSideM,
      adRangeM: R.adRangeM,
      routes: r.routes.map((q) => ({ id: q.id, rank: q.rank, line: q.pts.map(([x, y]) => toM(x, y)), to: q.to, lengthM: q.lengthM, seenPct: q.seenPct, valleyPct: q.valleyPct, parallelPct: q.parallelPct, buaPct: q.buaPct, follows: q.follows, wires: q.wires, obstructionsNear: q.obstructionsNear, why: q.why, profile: q.profile })),
      lzs: r.lzs.map(zone),
      dzs: r.dzs.map(zone),
      ad: r.ad.map((q) => ({ id: q.id, rank: q.rank, at: toM(q.x, q.y), seenM: q.seenM, longM: q.longM, flankM: q.flankM, bottom: q.bottom, kinds: q.kinds, routes: q.routes, why: q.why })),
      obstructions: obstructions
        .map((o) => ({ at: toM(o.x, o.y), kind: o.kind, label: o.label, heightM: o.heightM ?? R.pointH[o.kind] ?? 20 }))
        .filter((o) => inFrameM(o.at))
        .slice(0, 300),
      observers: r.observers,
      notes: [...notes, ...r.notes],
      ms: r.ms,
    };
  }

  /** Annex A for the area's middle and the month, from the bundle's visibility and climate grids. */
  private _ipbWxFor(v: IpbApchView): IpbWxView | null {
    const xs = v.frame.map((p) => p[0]), ys = v.frame.map((p) => p[1]);
    if (!xs.length) return null;
    const [lon, lat] = mercatorToLngLat((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
    const month = resolveMonth(this._opts.going.month);
    const vg = this._visibility?.get() ?? null;
    const vr = vg ? visibilityAt(vg, lon, lat, month) : null;
    const cl = this._climate?.normalsAt(lon, lat) ?? null;
    const rows = annexA((IPB_DOCTRINE as any).weather?.rows ?? [], {
      month,
      vis: vr ? { meanViewKm: vr.meanViewKm, lt2kmPct: vr.lt2kmPct, fogPct: vr.fogPct, stationKm: vr.stationKm } : null,
      clim: cl ? { tmin: cl.tmin, tmax: cl.tmax, wind: cl.wind, prec: cl.prec } : null,
    });
    return { month, rows, stationKm: vr?.stationKm ?? null };
  }

  /** The threat's place in Web Mercator, when it is one (`extended.threat: point`). */
  private _threatMerc(): MercXY | null {
    const o = this._opts.extended;
    return o.threat === 'point' && o.at ? (lngLatToMercator(o.at[0], o.at[1]) as MercXY) : null;
  }

  /**
   * The Extended View's reading for the rail at a spot that is not being placed (a selected or placed symbol, the map centre):
   * asks for the tiles it needs (as far as the threat's place, up to 10 km) and reads from those in memory. Null until
   * the elevation is there, or for a symbol that is not terrain-bound.
   */
  private _scopeExtRead(at: MercXY, profile: GroundGuideProfile, sidc: string | null): GroundGuideOcoka | null {
    const m = this._manifest;
    const L = this._sectionLayers();
    this._scopeExtRd = null;
    if (!m || !this._cache || !L.elevHi || !L.elevLo || profile === 'exempt') return null;
    const z = m.zoom.max;
    const k = Math.cosh(at[1] / 6378137); // Web Mercator metres per ground metre here
    let reachM = this._opts.extended.radiusKm * 1000;
    const t = this._threatMerc();
    if (t) {
      const d = Math.hypot(t[0] - at[0], t[1] - at[1]) / k;
      if (d <= 10000) reachM = Math.max(reachM, d + 600);
    }
    const reach = (reachM + 600) * k;
    const a = mercatorToTilePixel(at[0] - reach, at[1] + reach, z, m.tileSize);
    const b = mercatorToTilePixel(at[0] + reach, at[1] - reach, z, m.tileSize);
    const n = 2 ** z;
    const layers = [this._layerNames(profile).cls, L.elevHi, L.elevLo, L.bld].filter((x): x is string => !!x);
    for (let ty = Math.max(0, a.ty); ty <= Math.min(n - 1, b.ty); ty++) {
      for (let tx = Math.max(0, a.tx); tx <= Math.min(n - 1, b.tx); tx++) {
        for (const layer of layers) this._cache.request(layer, z, tx, ty);
      }
    }
    this._visibility?.get(); // starts the month's visibility grid if it is not in memory
    const r = this._readExt(at, profile, sidc, false);
    const rd = this._extRead;
    if (r && rd) this._scopeExtRd = { key: rd.key, grid: rd.grid, ox: rd.ox, oy: rd.oy };
    if (!this._extCtx) this._apchAsk(at, sidc ?? null); // nothing placed: the avenues read round the rail's spot
    return r;
  }

  /**
   * The rail's reading with its map products: the fan, the lines of sight and the threat's view at once; the approaches
   * and the better position once the spot has rested for a quarter of a second (the map centre moves with every pan).
   */
  private _scopeExtProducts(r: GroundGuideOcoka, at: MercXY, profile: GroundGuideProfile, frontageM: number): GroundGuideOcoka {
    const rd = this._scopeExtRd;
    if (!rd) return r;
    const key = `${rd.key}|${frontageM}`;
    try {
      let made = this._scopeExtMade;
      const args = (): OcokaMapArgs => this._extArgs({ grid: rd.grid, ox: rd.ox, oy: rd.oy, at, lngLat: r.lngLat, profile, reading: r, frontageM });
      if (!made || made.key !== key) made = this._scopeExtMade = { key, sight: ocokaSight(args()), plan: null };
      if (!made.plan && !r.pending) {
        if (this._scopePlanKey === key) made.plan = ocokaPlan(args());
        else {
          if (this._scopePlanTimer !== null) clearTimeout(this._scopePlanTimer);
          this._scopePlanTimer = setTimeout(() => {
            this._scopePlanTimer = null;
            this._scopePlanKey = key; // the next draw works the plan out for this spot
            this._scopeSoon(0);
          }, 240);
        }
      }
      return { ...r, sight: made.sight, plan: made.plan, ipbApch: this._apchViewNow() };
    } catch (err) {
      console.error('[Ground Guide] Gr Scope Extended View products', err);
      return r;
    }
  }

  // ── Gr Scope rail: the AOR scale (Shift+V) ───────────────────────────────────────────────────────────────────────────

  /** The rail's scale: `spot` (the ground round one symbol) or `aor` (the area of ops read as an appreciation). */
  get scopeScale(): 'spot' | 'aor' {
    return this._opts.aor.scale;
  }

  /** Switch the rail between Spot and AOR (Shift+V; no argument toggles). The rail is shown if it was hidden. Kept in the settings. */
  setScopeScale(scale: 'spot' | 'aor' = this._opts.aor.scale === 'aor' ? 'spot' : 'aor'): void {
    this.setAor({ scale });
    if (!this._scope.wanted) this.showScope(true);
  }

  /**
   * Set any of the AOR scale's options (layout, style, orient, source, box, echelon, leadKm, corridorM, profile, keys,
   * scale) at once; they are kept in the settings, and the rail redraws at once.
   */
  setAor(patch: Partial<GroundGuideAorOptions>): void {
    this.setOptions({ aor: { ...this._opts.aor, ...patch } });
    const now = this._opts.aor;
    for (const k of Object.keys(patch) as Array<keyof GroundGuideAorOptions>) setSetting(['groundGuide', 'aor', k], now[k] as any);
  }

  /** The MITG the AOR is read for, overriding the rail's choice (a VG symbol, the selected or placed symbol, the map centre); null gives the choice back. */
  setAorAnchor(point: any | null): void {
    const ll = point === null ? null : this._lngLatOf(point);
    this._aorAnchor = ll ? (lngLatToMercator(ll[0], ll[1]) as MercXY) : null;
    this._scopeSoon(0, true);
  }

  /** The last AOR reading the rail drew (null before one), for hosts. Ground metres east / north of the MITG; see GroundGuideAor.ts. */
  aorReading(): AorReading | null {
    return this._aorLast?.reading ?? null;
  }

  /** The AOR reading as the appreciation paragraph (AprDf numbering), as Copy as Text gives it; null before a reading. */
  aorText(): string | null {
    const f = this._aorLast;
    return f?.reading ? aorText(f.reading, f) : null;
  }

  /** Arm a box for the AOR: the next drag on the map draws it (the map does not pan); Esc cancels. Sets `aor.source: box`. */
  drawAorBox(): void {
    const view: any = this._getView?.();
    if (!view?.on || !view.container) return;
    this._aorBoxCancel();
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;display:none;border:2px dashed #1f4fb3;background:rgba(31,79,179,.10);pointer-events:none;z-index:40;box-sizing:border-box';
    const host: HTMLElement = view.container;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(div);
    const st: { handle: any; keyH: (e: KeyboardEvent) => void; div: HTMLDivElement | null; start: { x: number; y: number } | null } = { handle: null, keyH: () => undefined, div, start: null };
    st.handle = view.on('drag', (e: any) => {
      e.stopPropagation();
      if (e.action === 'start') {
        st.start = { x: e.x, y: e.y };
        div.style.display = 'block';
      }
      if (!st.start) return;
      const x0 = Math.min(st.start.x, e.x), y0 = Math.min(st.start.y, e.y);
      div.style.left = `${x0}px`;
      div.style.top = `${y0}px`;
      div.style.width = `${Math.abs(e.x - st.start.x)}px`;
      div.style.height = `${Math.abs(e.y - st.start.y)}px`;
      if (e.action !== 'end') return;
      const a = view.toMap?.({ x: st.start.x, y: st.start.y });
      const b = view.toMap?.({ x: e.x, y: e.y });
      this._aorBoxCancel();
      if (!a || !b || typeof a.longitude !== 'number' || typeof b.longitude !== 'number') return;
      const box: [number, number, number, number] = [Math.min(a.longitude, b.longitude), Math.min(a.latitude, b.latitude), Math.max(a.longitude, b.longitude), Math.max(a.latitude, b.latitude)];
      if (box[2] - box[0] < 0.005 || box[3] - box[1] < 0.005) return this._badge.flash('Box too small for an AOR: drag again (Draw in the rail).', 2400);
      this.setAor({ source: 'box', box });
    });
    st.keyH = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this._aorBoxCancel();
      }
    };
    document.addEventListener('keydown', st.keyH, true);
    this._aorBoxDrag = st;
    this._badge.flash('Drag on the map for the AOR box. Esc cancels.', 2600);
  }

  private _aorBoxCancel(): void {
    const st = this._aorBoxDrag;
    if (!st) return;
    try {
      st.handle?.remove?.();
    } catch {
      /* the view is gone */
    }
    document.removeEventListener('keydown', st.keyH, true);
    st.div?.remove();
    this._aorBoxDrag = null;
  }

  /** A control of the rail's AOR scale. */
  private _aorAction(act: string): void {
    const [k, v] = act.split(':');
    if (k === 'scale') return this.setScopeScale('spot');
    if (k === 'layout') return this.setAor({ layout: v as GroundGuideAorOptions['layout'] });
    if (k === 'style') return this.setAor({ style: v as GroundGuideAorOptions['style'] });
    if (k === 'orient') return this.setAor({ orient: v as GroundGuideAorOptions['orient'] });
    if (k === 'src') {
      this.setAor({ source: v as GroundGuideAorOptions['source'] });
      if (v === 'box' && !this._opts.aor.box) this.drawAorBox();
      return;
    }
    if (k === 'box') return this.drawAorBox();
    if (k === 'sheet') this._toggleAorSheet(!this._aorSheet.isOpen, 'confirm');
  }

  /** D in the AOR scale: the approach sheets beside the rail. */
  private _toggleAorSheet(open: boolean, tab?: string): void {
    const f = this._aorLast;
    if (!open || !f?.reading) return this._aorSheet.close();
    this._aorSheet.open(f.reading, f, this._scope.rect, this._opts.scope.side, tab);
  }

  /** Per class code, how the AOR reads it, for a mode (built once per bundle and mode). */
  private _aorClassTables(profile: GroundGuideProfile, going: CompiledProfile): AorClassTables {
    const memo = this._aorTables;
    if (memo && memo.rules === this._rules && (memo as any).profile === profile) return memo.t;
    const kind = new Uint8Array(256), rank = new Uint8Array(256), cover = new Uint8Array(256), country = new Uint8Array(256);
    const classes = (this._rules?.classes ?? {}) as Record<string, any>;
    for (let c = 0; c < 256; c++) {
      if (c === 255) continue;
      const def = classes[String(c)];
      const name = String((def && typeof def === 'object' ? def.name : def) ?? '').toLowerCase();
      const linear = /^(canal|distributary|drain|embankment|bund|cutting|railway|wire|road_|bridge_|rail_bridge|foot_bridge|ford|stream_|nullah|irrigated_wire|wall_fence|level_crossing)/.test(name);
      const artificial = /^(built_up|restricted|walled_orchard|orchard|graveyard|irrigated_cropland|cropland|industrial|airfield)/.test(name);
      if (linear) kind[c] = 9;
      else if (going.nogo[c]) kind[c] = artificial ? 2 : 1;
      else if (going.caution[c]) kind[c] = artificial ? 4 : 3;
      rank[c] = /^(bridge_|rail_bridge|foot_bridge|ford|level_crossing)/.test(name) ? 4 : going.nogo[c] ? 3 : going.caution[c] ? 2 : 1;
      cover[c] = name === 'built_up' ? 1 : /tree|forest|orchard/.test(name) ? 2 : 0;
      country[c] = /steep|moderate_slope|escarp|sloping/.test(name) ? 1 : /bare_desert|^sand|dunes|salt|rocky/.test(name) ? 2 : /^water_|wetland|riverbed|mangrove/.test(name) ? 3 : name === 'built_up' ? 4 : /canal|distributary|drain|irrigated/.test(name) ? 5 : name === 'cropland' ? 6 : 0;
    }
    const t: AorClassTables = { kind, rank, cover, country };
    this._aorTables = Object.assign({ rules: this._rules as unknown, t }, { profile });
    return t;
  }

  /** The bundle's borders (boundaries.geojson), read once per bundle; [] when it has none. Null while it loads. */
  private _aorBorderLines(): Array<{ name: string; xy: Float64Array }> | null {
    const url = this._opts.bundleUrl ? `${this._opts.bundleUrl}/boundaries.geojson` : '';
    if (!url) return [];
    if (this._aorBordersUrl === url) return this._aorBorders;
    this._aorBordersUrl = url;
    this._aorBorders = null;
    void fetch(url, { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (this._aorBordersUrl !== url) return;
        const out: Array<{ name: string; xy: Float64Array }> = [];
        for (const f of fc?.features ?? []) {
          const kind = String(f?.properties?.kind ?? '');
          if (!kind || /province|corps/i.test(kind)) continue;
          const g = f.geometry;
          const parts: number[][][] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
          const name = String(f.properties?.name || (/line of control/i.test(kind) ? 'LOC' : 'Border'));
          for (const part of parts) {
            if (!Array.isArray(part) || part.length < 2) continue;
            const xy = new Float64Array(part.length * 2);
            part.forEach((c, i) => {
              const m = lngLatToMercator(c[0], c[1]);
              xy[i * 2] = m[0];
              xy[i * 2 + 1] = m[1];
            });
            out.push({ name: name.replace(/\s*Border$/i, ' border'), xy });
          }
        }
        this._aorBorders = out;
        this._scopeSoon(0, true);
      })
      .catch(() => {
        if (this._aorBordersUrl === url) this._aorBorders = [];
      });
    return null;
  }

  /** The VG (Vital Gr, MITG) symbol nearest the view's centre, Web Mercator; null when there is none on the map. */
  private _aorVitalGround(near: MercXY): { at: MercXY; name: string | null } | null {
    let best: { at: MercXY; name: string | null } | null = null, bd = Infinity;
    for (const g of this._placedGraphics()) {
      const s = normaliseSidc(graphicSidc(g));
      if (!s || s.length !== 20 || s.substring(4, 6) !== '25' || s.substring(10, 16) !== '242301') continue;
      const shape = toMercatorShape(g.geometry);
      const pts = shape?.parts.flat() ?? [];
      if (!pts.length) continue;
      const c: MercXY = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
      const d = Math.hypot(c[0] - near[0], c[1] - near[1]);
      if (d < bd) {
        bd = d;
        const de = g.attributes?.drawEssentials;
        const nm = de?.AMPLIFIER?.UNIQUE_DESIG || de?.AMPLIFIER?.T || null;
        best = { at: c, name: typeof nm === 'string' && nm.trim() ? nm.trim() : null };
      }
    }
    return best;
  }

  /**
   * The AOR's outline in Web Mercator for the source asked for, with the source used and why it fell back: Boundary
   * symbols either side of the MITG, the dragged box, or the echelon's frame facing the threat.
   */
  private _aorOutline(at: MercXY, faceDeg: number, ech: 'coy' | 'bn' | 'bde'): { ring: MercXY[]; used: GroundGuideAorOptions['source']; note: string | null } {
    const o = this._opts.aor;
    const k = Math.cosh(at[1] / 6378137);
    const th = (faceDeg * Math.PI) / 180;
    const F: MercXY = [Math.sin(th), Math.cos(th)], R: MercXY = [Math.cos(th), -Math.sin(th)];
    const toM = (u: number, v: number): MercXY => [at[0] + (u * F[0] + v * R[0]) * k, at[1] + (u * F[1] + v * R[1]) * k];
    const uv = (p: MercXY): [number, number] => {
      const dx = (p[0] - at[0]) / k, dy = (p[1] - at[1]) / k;
      return [dx * F[0] + dy * F[1], dx * R[0] + dy * R[1]];
    };
    const fr = AOR_FRAME[ech];
    const frame = (): MercXY[] => [toM(-fr.rear, -fr.w / 2), toM(fr.fwd, -fr.w / 2), toM(fr.fwd, fr.w / 2), toM(-fr.rear, fr.w / 2)];
    if (o.source === 'box') {
      if (!o.box) return { ring: frame(), used: 'echelon', note: 'No box yet: Draw' };
      const [w, s, e, n] = o.box;
      return { ring: [lngLatToMercator(w, s), lngLatToMercator(w, n), lngLatToMercator(e, n), lngLatToMercator(e, s)] as MercXY[], used: 'box', note: null };
    }
    if (o.source === 'boundaries') {
      // Boundary lines (2525D set 25, entity 110100) within reach; the nearest on each side of the axis.
      let left: Array<[number, number]> | null = null, right: Array<[number, number]> | null = null, ld = Infinity, rd = Infinity;
      for (const g of this._placedGraphics()) {
        const s = normaliseSidc(graphicSidc(g));
        if (!s || s.length !== 20 || s.substring(4, 6) !== '25' || s.substring(10, 16) !== '110100') continue;
        const shape = toMercatorShape(g.geometry);
        if (!shape) continue;
        const pts: Array<[number, number]> = [];
        for (const part of shape.parts)
          for (let i = 0; i + 1 < part.length; i++) {
            const a = uv(part[i]), b = uv(part[i + 1]);
            const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 200));
            for (let j = 0; j <= n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
          }
        const inside = pts.filter((p) => p[0] >= -fr.rear && p[0] <= fr.fwd);
        if (inside.length < 2) continue;
        const near = inside.reduce((m, p) => (Math.abs(p[1]) < Math.abs(m[1]) ? p : m));
        if (Math.abs(near[1]) > 15000) continue;
        if (near[1] < 0 && -near[1] < ld) ((ld = -near[1]), (left = inside));
        if (near[1] > 0 && near[1] < rd) ((rd = near[1]), (right = inside));
      }
      if (!left || !right) return { ring: frame(), used: 'echelon', note: 'Bdys: need one each side' };
      const L2 = [...left].sort((a, b) => a[0] - b[0]);
      const R2 = [...right].sort((a, b) => b[0] - a[0]);
      return { ring: [...L2, ...R2].map((p) => toM(p[0], p[1])), used: 'boundaries', note: null };
    }
    return { ring: frame(), used: 'echelon', note: null };
  }

  /** Read and draw the rail's AOR scale: the anchor and threat, the outline, the grid and features, then the reading (worked out once per AOR, off the frame). */
  private _aorRender(): void {
    const m = this._manifest, cache = this._cache;
    if (!m || !cache) return;
    const view: any = this._getView?.();
    const o = this._opts.aor;
    // The MITG: set by the API, else a VG symbol on the map, else the selected or placed symbol, else the map centre.
    const centreShape = view?.center ? toMercatorShape(view.center) : null;
    const vc = centreShape?.parts[0]?.[0] ?? null;
    let anchor: MercXY | null = this._aorAnchor;
    let anchorName: string | null = null;
    let sidc: string | null = null;
    if (!anchor && vc) {
      const vg = this._aorVitalGround(vc);
      if (vg) ((anchor = vg.at), (anchorName = vg.name));
    }
    const g0 = !anchor ? (this._scopeSelected?.geometry ? this._scopeSelected : this._scopePlaced?.graphic?.geometry ? this._scopePlaced.graphic : null) : null;
    if (g0) {
      const pts = toMercatorShape(g0.geometry)?.parts.flat() ?? [];
      if (pts.length) anchor = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
      sidc = graphicSidc(g0);
    }
    if (!anchor) anchor = vc;
    if (!anchor) return;
    // Snap to 250 m so a small pan of the map centre does not read a new AOR.
    const kA = Math.cosh(anchor[1] / 6378137);
    const snap = 250 * kA;
    if (!this._aorAnchor && !g0) anchor = [Math.round(anchor[0] / snap) * snap, Math.round(anchor[1] / snap) * snap];
    const code = echelonCodeOf(sidc);
    const ech: 'coy' | 'bn' | 'bde' = o.echelon !== 'auto' ? o.echelon : !code ? 'bn' : Number(code) <= 15 ? 'coy' : Number(code) <= 17 ? 'bn' : 'bde';
    // The threat: a place on the map, else a bearing (set, or the unit's front).
    const oc = this._opts.extended;
    const tAt = this._threatMerc();
    let face = oc.threat === 'bearing' ? oc.bearingDeg : this._opts.footprint.bearingDeg;
    if (tAt) face = ((Math.atan2(tAt[0] - anchor[0], tAt[1] - anchor[1]) * 180) / Math.PI + 360) % 360;
    const { ring, used, note } = this._aorOutline(anchor, face, ech);
    // Where the approaches start: forward of the AOR's front, across its width (or round the threat's place).
    const th = (face * Math.PI) / 180;
    const F: MercXY = [Math.sin(th), Math.cos(th)], R: MercXY = [Math.cos(th), -Math.sin(th)];
    const uv = (p: MercXY): [number, number] => {
      const dx = (p[0] - anchor![0]) / kA, dy = (p[1] - anchor![1]) / kA;
      return [dx * F[0] + dy * F[1], dx * R[0] + dy * R[1]];
    };
    const toM = (u: number, v: number): MercXY => [anchor![0] + (u * F[0] + v * R[0]) * kA, anchor![1] + (u * F[1] + v * R[1]) * kA];
    let uFront = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const p of ring) {
      const [u, v] = uv(p);
      uFront = Math.max(uFront, u);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    }
    const wv = Math.max(600, vMax - vMin);
    let origins: AorInput['origins'];
    if (tAt) {
      const [ut, vt] = uv(tAt);
      const u0 = Math.max(uFront + 1000, ut);
      const vc2 = Math.min(vMax, Math.max(vMin, vt));
      origins = (['Lt', 'Cen', 'Rt'] as AorSide[]).map((side, i) => ({ side, at: toM(u0, vc2 + ((i - 1) * wv) / 3) }));
    } else {
      const u0 = uFront + o.leadKm * 1000;
      origins = (['Lt', 'Cen', 'Rt'] as AorSide[]).map((side, i) => ({ side, at: toM(u0, vMin + (wv * (1 + 2 * i)) / 6) }));
    }
    const corridorM = o.corridorM || { coy: 1000, bn: 2000, bde: 4000 }[ech];
    const frontLimit = { coy: { m: 2000, label: 'a Coy' }, bn: { m: 6500, label: 'Bn 3 coys up' }, bde: { m: 12000, label: 'a Bde' } }[ech];
    const profile = (this._rules?.profiles?.[o.profile] ? o.profile : 'tracked') as GroundGuideProfile;
    const month = resolveMonth(this._opts.going.month);
    const frame: AorFrame = {
      reading: null,
      layout: o.layout,
      style: o.style,
      orient: o.orient,
      layers: { ...this._scope.aorLayers },
      northDeg: this._north,
      source: o.source,
      used,
      note,
      echelon: { coy: 'Coy', bn: 'Bn', bde: 'Bde' }[ech],
      profileLabel: this._rules?.profiles?.[profile]?.label?.replace(/ Vehicle$/, '') ?? profile,
      when: monthName(month),
      season: 'dry',
      month: monthName(month),
      loading: true,
      keys: { detail: o.keys && !this._touchInput },
    };
    const mitg = { at: anchor, name: anchorName };
    const key = `${aorInputKey({ outline: ring, faceDeg: face, mitg, origins, corridorM, source: used })}|${profile}|${this._opts.bundleUrl}`;
    const made = this._aorMade;
    if (made && made.key === key && !made.reading.pending) {
      frame.reading = made.reading;
      frame.loading = false;
      return this._aorShow(frame);
    }
    // The grid: the bundle's finest class tiles over the AOR and the starts, a cell of 1 to 4 tile pixels (a canal stays a line).
    const going = this._profile(profile);
    const tables = this._aorClassTables(profile, going);
    const z = m.zoom.max, ts = m.tileSize;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of [...ring, ...origins.map((q) => q.at), anchor]) {
      const [px, py] = mercToPx(p[0], p[1], z, ts);
      x0 = Math.min(x0, px);
      y0 = Math.min(y0, py);
      x1 = Math.max(x1, px);
      y1 = Math.max(y1, py);
    }
    const lat = mercatorToLngLat(anchor[0], anchor[1])[1];
    const padPx = 2000 / mPerPx(lat, z, ts);
    x0 -= padPx;
    y0 -= padPx;
    x1 += padPx;
    y1 += padPx;
    const f = Math.max(1, Math.ceil(Math.max(x1 - x0, y1 - y0) / 480));
    const { cls } = this._layerNames(profile);
    const n = 2 ** z;
    for (let ty = Math.max(0, Math.floor(y0 / ts)); ty <= Math.min(n - 1, Math.floor(y1 / ts)); ty++)
      for (let tx = Math.max(0, Math.floor(x0 / ts)); tx <= Math.min(n - 1, Math.floor(x1 / ts)); tx++) cache.request(cls, z, tx, ty);
    const grid = buildAorGrid((layer, x, y) => cache.peek(layer, z, x, y), cls, z, ts, lat, x0, y0, x1, y1, f, tables.rank);
    // Features over the same ground, and the borders.
    const cMerc: MercXY = [(ring.reduce((a, p) => a + p[0], 0) + anchor[0]) / (ring.length + 1), (ring.reduce((a, p) => a + p[1], 0) + anchor[1]) / (ring.length + 1)];
    let radiusM = 0;
    for (const p of [...ring, ...origins.map((q) => q.at)]) radiusM = Math.max(radiusM, Math.hypot(p[0] - cMerc[0], p[1] - cMerc[1]) / kA);
    radiusM += 2500;
    const feats = this._features?.sceneNear(cMerc, radiusM) ?? { points: [], lines: [], pending: false };
    const borders = this._aorBorderLines();
    if (grid.g.pending || feats.pending || borders === null) {
      // Still on its way: the last reading of this AOR, else "reading".
      if (made && made.key === key) frame.reading = made.reading;
      return this._aorShow(frame);
    }
    if (this._aorWorkKey === key && this._aorWork !== null) return this._aorShow(frame); // already being worked out
    const PLACE = new Set(['city', 'district_hq', 'town', 'village_imp', 'village']);
    const BRIDGE = new Set(['bridge', 'bridge_iron', 'boat_bridge', 'viaduct']);
    const places: AorInput['places'] = [];
    const bridges: AorInput['bridges'] = [];
    const itg: AorInput['itg'] = [];
    for (const p of feats.points) {
      if (PLACE.has(p.key)) {
        const name = tidyName(p.a.n);
        const ppl = Number(p.a.wp ?? p.a.p);
        if (name) places.push({ name, at: [p.x, p.y], people: Number.isFinite(ppl) ? ppl : 0 });
      } else if (BRIDGE.has(p.key)) bridges.push({ at: [p.x, p.y], classed: p.a.c !== undefined && p.a.c !== null && p.a.c !== '' });
      if ((p.a.it === 1 || p.a.it === 2) && typeof p.a.ig === 'string') itg.push({ at: [p.x, p.y], reason: p.a.ig });
    }
    const lines: AorInput['lines'] = feats.lines.filter((l) => l.key === 'road' || l.key === 'canal' || l.key === 'river' || l.key === 'railway' || l.key === 'ridgeline').map((l) => ({ name: tidyName(l.a.n), key: l.key, xy: l.xy, a: l.a }));
    // Borders: only the stretch near the AOR.
    const bx0 = cMerc[0] - radiusM * kA, bx1 = cMerc[0] + radiusM * kA, by0 = cMerc[1] - radiusM * kA, by1 = cMerc[1] + radiusM * kA;
    const near: AorInput['borders'] = [];
    for (const b of borders) {
      let run: number[] = [];
      const flush = () => {
        if (run.length >= 4) near.push({ name: b.name, xy: Float64Array.from(run) });
        run = [];
      };
      for (let i = 0; i + 1 < b.xy.length; i += 2) {
        const x = b.xy[i], y = b.xy[i + 1];
        if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) run.push(x, y);
        else flush();
      }
      flush();
    }
    const input: AorInput = {
      grid,
      going,
      tables,
      outline: ring,
      source: used,
      faceDeg: face,
      mitg,
      origins,
      originsAssumed: !tAt,
      corridorM,
      frontLimit,
      borders: near,
      places,
      lines,
      bridges,
      itg,
    };
    // Worked out off the frame: "reading" shows first, then the answer.
    this._aorWorkKey = key;
    if (this._aorWork !== null) clearTimeout(this._aorWork);
    this._aorWork = setTimeout(() => {
      this._aorWork = null;
      try {
        const reading = readAor(input);
        this._aorMade = { key, reading };
        EngineLogger.success(ENGINE, `Gr Scope AOR: ${reading.apchs.length} apchs, ${reading.lines.length} lines, ${reading.ms} ms`);
        this._emit('ground-guide-aor', { reading });
      } catch (err) {
        console.error('[Ground Guide] AOR reading', err);
        this._aorMade = null;
      }
      this._aorWorkKey = '';
      this._scopeSoon(0, true);
    }, 260);
    if (made && made.key === key) frame.reading = made.reading;
    this._aorShow(frame);
  }

  private _aorShow(frame: AorFrame): void {
    this._aorLast = frame;
    this._scope.renderAor(frame);
    if (this._aorSheet.isOpen) this._aorSheet.update(frame.reading, frame, this._scope.rect, this._opts.scope.side);
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
    v.clear = this._clearFor(geometry, sidc, v);
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
    v.extended = keys && this._opts.extended.keys ? this._ext : null;
    v.extKept = this._ext && this._keptNow();
    // It reads a point symbol (a unit or a weapon where it stands): a line or an area is drawn with it resting.
    v.extRest = this._ext && geometry?.type !== 'point' ? 'Rests on lines and areas' : null;
    v.ext = this._ext && !v.extRest ? this._extNear(geometry, sidc, v) : null;
    if (!v.ext) this._extMapClear();
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
    this._extOnDrawEnd();
    this._badge.hide();
    this._badge.setKeepClear(null);
    this._indicators.hide();
    this._indicators.hideFootprint();
    this._extMapClear();
    this._legend.hideHint('exempt');
    this._detachPointer();
    this._lastDetail = null;
    this._extOffMap(); // dropped (or cancelled): the Extended View's products leave the map until the next draw
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
    if (this._clearTimer !== null) {
      clearTimeout(this._clearTimer);
      this._clearTimer = null;
    }
    this._clear = null;
    if (this._scopeLive) {
      this._scopeLive = null; // the rail goes back to the selected symbol, the one just placed or the map centre
      this._scopeSoon(0, true);
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
    this._placedThisDraw = true; // the Extended View stays on for the next of the same kind (extended.lasts: symbol)
    if (this._extPin) this._extOffMap(); // nothing of it stays on the map after the drop
    // The Gr Scope rail stays on the symbol just placed until the map is panned (or another is placed or selected).
    if (graphic?.geometry) {
      const c = (this._getView?.() as any)?.center;
      this._scopePlaced = { graphic, centre: c ? (toMercatorShape(c)?.parts[0]?.[0] ?? null) : null };
      this._scopeSoon(0, true);
    }
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
    this._scopeSoon(0, true); // the rail may be on one of them
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

  /**
   * The nearest clear ground for the point being drawn when some of it is in NO-GO (`GroundGuideVerdict.clear`). It is
   * the snap search (`_findSnap`, the S Quick Fix's own, footprint included), so the hint chip points where S would move
   * the symbol. Throttled (CLEAR_INTERVAL_MS / CLEAR_REUSE_PX). Null for lines and areas, for a verdict with nothing in
   * NO-GO, and while the search is still waiting on tiles; `at: null` when it found none within `searchedM`.
   */
  private _clearFor(geometry: any, sidc: string | null, v: GroundGuideVerdict): GroundGuideClearGround | null {
    const inNoGo = v.verdict === 'in' || v.verdict === 'partial' || (v.verdict === 'near' && v.fraction > 0);
    if (geometry?.type !== 'point' || !inNoGo || v.loading || !this._manifest) return null;
    const origin = toMercatorShape(geometry)?.parts[0]?.[0];
    if (!origin) return null;
    const zoom = this._sampleZoom();
    const key = `${sidc ?? ''}|${v.profile}|${zoom}`;
    const reuseM = CLEAR_REUSE_PX * resolutionAt(zoom, this._manifest.tileSize);
    const now = performance.now();
    let c = this._clear?.key === key ? this._clear : null;
    const movedM = c ? Math.hypot(origin[0] - c.origin[0], origin[1] - c.origin[1]) : Infinity;
    const moved = movedM > reuseM;
    // Search now when: none yet; the last one was waiting on tiles (a tile arriving re-judges the cursor); the
    // interval is up; or the cursor has gone over half the way to the spot it found (a quarter of the search's reach
    // when it found none), so the answer may well have changed. A near spot is a short search, so this costs little.
    const farM = c ? (c.at ? Math.hypot(c.at[0] - c.origin[0], c.at[1] - c.origin[1]) / 2 : c.searchedM / 4) : 0;
    const stale = c !== null && moved && (now - c.t >= CLEAR_INTERVAL_MS || movedM > farM);
    if (!c || c.verdict === 'unknown' || stale) {
      const f = this._findSnap(geometry, sidc);
      // Nothing found while tiles are still arriving is not "none": say nothing until the search can tell.
      c = this._clear = f.at
        ? { key, origin, at: f.at, verdict: f.verdict, searchedM: f.searchedM, t: now }
        : { key, origin, at: null, verdict: f.loading ? 'unknown' : null, searchedM: f.searchedM, t: now };
    } else if (moved) {
      this._clearSoon(); // kept the last spot for this move; search again once the cursor rests
    }
    if (c.verdict === 'unknown') return null;
    if (!c.at) return { at: null, distanceM: null, bearingDeg: null, compass: null, verdict: null, searchedM: c.searchedM };
    const dx = c.at[0] - origin[0];
    const dy = c.at[1] - origin[1];
    const lat = 2 * Math.atan(Math.exp(origin[1] / 6378137)) - Math.PI / 2;
    const bearingDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    return {
      at: c.at,
      distanceM: Math.hypot(dx, dy) * Math.cos(lat), // Web Mercator metres to ground metres here
      bearingDeg,
      compass: COMPASS[Math.round(bearingDeg / 45) % 8],
      verdict: c.verdict,
      searchedM: c.searchedM,
    };
  }

  /** Judge the cursor again once it rests, so the chip's clear ground is searched from where it stopped. */
  private _clearSoon(): void {
    if (this._clearTimer !== null) return;
    this._clearTimer = setTimeout(() => {
      this._clearTimer = null;
      const d = this._lastDetail;
      if (d && this.isActive) this._apply(this._judgeLive(d.geometry, d.sidc));
    }, CLEAR_INTERVAL_MS);
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
    this._extMap.onViewChanged();
    this._ipbMap.onViewChanged();
    this._apchMap.onViewChanged();
    this._apchDraw(); // the same avenues on the new view's map
    this._ipbLast = null;
    this._extOverGrid = null; // the Extended View's overlay is drawn again on the new view's map
    this._extViewKey = '';
    this._extOverlaySoon(0);
    this._extDrawnKey = '';
    this._removePopulationLayer(); // and the People layer and its key go to the new view
    this._syncPopulationLayer();
    this._syncScope(); // the rail docks to the new view's container
  }

  destroy(): void {
    this.disable();
    this._indicators.destroy();
    this._extMapClear();
    if (this._extOverTimer !== null) clearTimeout(this._extOverTimer);
    this._extOverTimer = null;
    if (this._extCancelTimer !== null) clearTimeout(this._extCancelTimer);
    this._extCancelTimer = null;
    this._extMap.destroy();
    this._ipbMap.destroy();
    this._apchClear();
    this._apchMap.destroy();
    this._ipbLast = null;
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
    this._keyNotice.destroy();
    if (this._scopeTimer !== null) clearTimeout(this._scopeTimer);
    this._scopeTimer = null;
    if (this._scopePlanTimer !== null) clearTimeout(this._scopePlanTimer);
    this._scopePlanTimer = null;
    this._scope.destroy();
    this._scopeUiPad(); // the rail is gone: the host's UI padding goes back
    this._scopeSelected = null;
    this._scopePlaced = null;
    if (this._aorWork !== null) clearTimeout(this._aorWork);
    this._aorWork = null;
    this._aorBoxCancel();
    this._aorSheet.destroy();
    this._aorMade = null;
    this._aorLast = null;
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
    if (plan && cand) {
      this._applyFootprint(v, plan, cand, effSidc, !opts?.light, opts?.self);
      const strip = frontBlocks(plan, cand, pts, samples, compiled);
      if (strip && v.footprint) ((v.footprint.front = strip.blocks), (v.footprint.frontEnds = strip.ends));
    }
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


  // ── Extended View (F) ─────────────────────────────────────────────────────────────────────────────────────────────

  /** The Extended View is on: the Detail has its three tabs, the map the threat and the products, the rail its mode. */
  get extended(): boolean {
    return this._ext;
  }

  /** The Extended View is kept on for every symbol (Shift+F, or `extended.lasts: kept`) rather than closing on a new one. */
  get extendedKept(): boolean {
    return this._ext && this._keptNow();
  }

  /**
   * Turn the Extended View on or off (F does this; so does the Detail's F tab). On: Obsn & Fd of Fire, Key Gr and
   * Approaches join the Ground Detail before the Legend, O and C gain a tile on the threat's side, the cursor card a
   * short block, the map the threat marker, the fire fan, lines of sight, the approaches and the better position, the
   * Gr Scope rail its Extended mode. Off: all of it goes and none of it is worked out. Not kept in the settings: it
   * starts off and goes off with the guide. Enforce mode stays on the GROTBC GO / NO-GO rule either way.
   * How long it lasts (`extended.lasts`, default `symbol`): while the same kind of symbol is placed; arming a
   * different kind or cancelling the draw closes it. `keep: true` (Shift+F) keeps it on for every symbol until F.
   */
  setExtended(on: boolean, opts: { keep?: boolean } = {}): void {
    this._setExt(!!on, true, opts.keep === true);
  }

  /** Turn the Extended View over (F); returns the new state. */
  toggleExtended(): boolean {
    this._setExt(!this._ext, true);
    return this._ext;
  }

  /** It stays on for every symbol: by Shift+F, or by the setting. */
  private _keptNow(): boolean {
    return this._extKept || this._opts.extended.lasts === 'kept';
  }

  /** `keep` (Shift+F) also works while it is already on: it then stays for every symbol. `why` goes on the event. */
  private _setExt(on: boolean, refresh: boolean, keep = false, why: 'key' | 'symbol' | 'cancel' | 'placed' | 'guide' = 'key'): void {
    if (this._extCancelTimer !== null) clearTimeout(this._extCancelTimer);
    this._extCancelTimer = null;
    if (on && (!this._enabled || !this._opts.extended.keys)) return;
    if (on === this._ext) {
      if (!on || !keep || this._extKept) return;
      this._extKept = true; // already on: Shift+F keeps it
    } else {
      this._ext = on;
      this._extKept = on && keep;
      this._extKind = on ? extKindOf(this._activeSidc) : null;
    }
    this._detail.setExtended(on, on && this._keptNow());
    if (!on) {
      this._extPinRelease();
      this._extMapClear();
      this._apchClear();
      this._extLive.clear();
      this._lastExt = null;
      this._scopeExtRd = null;
      this._scopeExtMade = null;
    }
    this._emit('ground-guide-extended', { on, kept: on && this._keptNow(), why });
    if (refresh) this._extChanged();
  }

  /**
   * A symbol was armed. The Extended View follows the kind of symbol it was opened for (`extended.lasts: symbol`):
   * the same kind again (the next Pl of a Coy, continuous placing) keeps it; a different kind closes it, said on the card.
   * Opened with nothing armed (reading the rail), it takes the first kind armed.
   */
  private _extOnArm(sidc: string | null): void {
    if (this._extCancelTimer !== null) {
      // A cancel followed at once by a new arm (a re-pick in the palette): judged by the kind, as any arm is.
      clearTimeout(this._extCancelTimer);
      this._extCancelTimer = null;
    }
    if (!this._ext || this._keptNow()) return;
    const kind = extKindOf(sidc);
    if (this._extKind === null) this._extKind = kind;
    else if (kind !== this._extKind) {
      this._setExt(false, true, false, 'symbol');
      this._badge.flash('Ext View closed: a new symbol. F opens it again; Shift+F keeps it on.', 3000);
    }
  }

  /**
   * A draw ended. Placed: it stays for the next of the same kind (with `extended.lasts: once` it closes). Cancelled
   * (Esc, or the draw dropped): it closes, unless a symbol is armed again at once (a re-pick in the palette), which
   * `_extOnArm` then judges by its kind.
   */
  private _extOnDrawEnd(): void {
    const drawing = this._lastDetail !== null;
    const placed = this._placedThisDraw;
    this._placedThisDraw = false;
    if (!this._ext || this._keptNow() || !drawing) return;
    if (placed) {
      if (this._opts.extended.lasts === 'once') {
        this._setExt(false, true, false, 'placed');
        this.announce('Ext View closed after the placement. F opens it for the next one.', 2600);
      }
      return;
    }
    if (this._extCancelTimer !== null) clearTimeout(this._extCancelTimer);
    this._extCancelTimer = setTimeout(() => {
      this._extCancelTimer = null;
      if (!this._ext || this._keptNow() || this._lastDetail !== null || this._activeSidc !== null) return;
      this._setExt(false, true, false, 'cancel');
      this.announce('Ext View closed with the draw. F opens it again.', 2600);
    }, 400);
  }

  /** The Extended View, its threat or its options changed: the marker, the map products, the overlay, the cards and the rail follow. */
  private _extChanged(): void {
    this._detail.refreshKeys(); // the key bar's Whose Options and the Ext View keys
    this._syncThreat();
    this._extDrawnKey = '';
    if (!this._ext || this._opts.mode === 'off') this._extMapClear();
    // The IPB avenues: gone with F (or the product); else read again if the threat, HQ, month or options moved the area.
    if (!this._apchOn()) this._apchClear();
    else this._apchSoon(150);
    this._syncOverlay(); // the going paint gives way to the Extended View's own overlay, and comes back
    if (this._extPin && !this._lastDetail) this._extPinShow(); // the symbol held: read again toward the new threat / side
    this._refreshLive();
    this._scopeSoon(0, true); // the rail reads in the same view, toward the same threat
  }

  /** The symbol a reading holds on: where it is, its SIDC, its mode (a mode set by hand when placed is kept), its frontage. */
  private _pinOf(graphic: any): GroundGuide['_extPin'] {
    const at = graphic?.geometry ? (toMercatorShape(graphic.geometry)?.parts[0]?.[0] as MercXY | undefined) : undefined;
    if (!at) return null;
    const sidc = graphicSidc(graphic);
    const stamp = readStamp(graphic);
    const profile: GroundGuideProfile = stamp?.profileOverride && this.profileChoices.includes(stamp.profile) ? stamp.profile : resolveProfile(sidc, this._rules);
    if (profile === 'exempt') return null;
    return { graphic, at: [at[0], at[1]], sidc, profile, frontageM: stamp?.frontageM || DEFAULT_FRONTAGE_M };
  }

  /** Hold the Extended View on a symbol (the one selected) and draw its products there. */
  private _extPinTo(graphic: any): void {
    const p = this._pinOf(graphic);
    if (!p) return;
    this._extPin = p;
    this._extPinTries = 0;
    this._extPinShow();
    this._syncOverlay();
  }

  private _extPinRelease(): void {
    this._extPin = null;
    if (this._extPinTimer !== null) clearTimeout(this._extPinTimer);
    this._extPinTimer = null;
  }

  /**
   * Take every Extended View product off the map (the drop, Esc, a cleared selection): the fan, the lines of sight, the
   * approaches and the better Posn, the IPB avenues with their fire, decision, air and template, and its overlay paint.
   * The Extended View itself stays on (`extended.lasts`) and the readings stay worked out, so the next draw in the same
   * area shows them again at once. The threat marker stays at the map's edge to set the threat before the next draw.
   */
  private _extOffMap(): void {
    this._extPinRelease();
    this._extMapClear();
    this._apchMap.clear();
    if (this._ext) this._syncOverlay(); // the overlay paint goes (and the GROTBC paint comes back, if it is on)
  }

  /**
   * Draw the Extended View's products for the symbol held (`_extPin`): read from the tiles in memory (asking for the
   * missing ones and trying again while they come), the fan, the lines of sight and the better Posn on it, and the IPB
   * reading round it. Nothing here follows the mouse or the map centre.
   */
  private _extPinShow(): void {
    const p = this._extPin;
    if (this._lastDetail) return; // a draw is on: the cursor leads
    if (!p || !this._ext || !this.isActive || this._opts.mode === 'off') {
      this._extPinRelease();
      return;
    }
    if (this._extPinTimer !== null) clearTimeout(this._extPinTimer);
    this._extPinTimer = null;
    const r = this._scopeExtRead(p.at, p.profile, p.sidc);
    const rd = this._extRead;
    if (!r || !rd || r.pending) {
      if (this._extPinTries++ < 25) {
        this._extPinTimer = setTimeout(() => {
          this._extPinTimer = null;
          this._extPinShow();
        }, 300);
      }
      if (!r || !rd) return;
    }
    this._lastExt = r;
    this._extCtx = { key: `${rd.key}|${p.frontageM}`, grid: rd.grid, ox: rd.ox, oy: rd.oy, at: p.at, lngLat: r.lngLat, profile: p.profile, reading: r, frontageM: p.frontageM };
    this._apchAsk(p.at, p.sidc);
    if (this._extOverlayKind() === 'ipb') this._extOverlaySoon(250);
    this._extMapSoon();
  }

  /**
   * Whose options the IPB reading shows (X while F is on; the switch in the Ground Detail's key bar). `defence`: the enemy's
   * avenues against the position, own fire on them, decision support, the enemy's air and his attack template.
   * `attack`: own avenues toward the threat, the enemy's fire on them, own air, his defence template. Kept in the settings.
   */
  setReadFor(readFor: 'defence' | 'attack'): void {
    if ((readFor !== 'defence' && readFor !== 'attack') || this._opts.extended.ipb.readFor === readFor) return;
    this.setOptions({ extended: { ...this._opts.extended, ipb: { ...this._opts.extended.ipb, readFor } } });
    setSetting(['groundGuide', 'extended', 'ipb', 'readFor'], readFor);
  }

  /**
   * X (or the Detail's key bar): the other side's options, or `to`. Returns the reading now and says it in the key notice
   * at the foot of the screen (on the card or the chip when the notice is off).
   */
  toggleReadFor(to?: 'defence' | 'attack'): 'defence' | 'attack' {
    const next = to ?? (this._opts.extended.ipb.readFor === 'defence' ? 'attack' : 'defence');
    this.setReadFor(next);
    const msg = next === 'defence' ? "En's options against you: his Apchs, your fire on them. X for yours." : "Your options against the threat: your Apchs, his fire on them. X for the en's.";
    this._notice(this._whoseNotice(), msg);
    return next;
  }

  // ── The key notice (card.keyNotice; user, 2026-11-14) ─────────────────────────────────────────────────────────────

  /**
   * Say a key's new mode and the keys that work in it at the foot of the screen for 5 s (the key notice), or, with the
   * notice off, `plain` on the cursor card while placing, else in the one-line chip (null: nothing).
   */
  private _notice(c: KeyNoticeContent, plain: string | null, ms = 2800): void {
    if (this._opts.card.keyNotice) {
      this._legend.hideHint('announce'); // the same place: one at a time
      this._keyNotice.show(c, 5000);
      return;
    }
    if (!plain) return;
    if (this._lastDetail) this._badge.flash(plain, ms);
    else this.announce(plain, ms);
  }

  /** The Extended View's keys while it is on, and what each does now. */
  private _extKeys(): KeyNoticeKey[] {
    const d = this._opts.extended.ipb.readFor === 'defence';
    return [
      ['1–5', 'its tabs'],
      ['X', d ? 'your options' : "the en's options"],
      ['[ ]', 'turn the threat'],
      ['J', 'better Posn'],
      ['F', 'close'],
      ...(this._keptNow() ? [] : ([['⇧F', 'keep on for every symbol']] as KeyNoticeKey[])),
    ];
  }

  /** Whose options the IPB reading shows now (X), what that brings and the keys to see it. */
  private _whoseNotice(): KeyNoticeContent {
    const d = this._opts.extended.ipb.readFor === 'defence';
    return {
      mode: d ? "En's options against you" : 'Your options against the threat',
      text: d ? 'His Apchs at you (red), your fire on them, his air, his attack template.' : 'Your Apchs at him (blue), his fire on them, your air, his defence template.',
      keys: [
        ['X', d ? 'your options' : "the en's options"],
        ['3', 'Apchs'],
        ['1', 'fire on them'],
        ['4', 'air'],
        ['5', 'decision'],
        ['[ ]', 'turn the threat'],
      ],
    };
  }

  /** F / Shift+F: the Extended View now. */
  private _extNotice(): KeyNoticeContent {
    if (!this._ext) return { mode: 'Ext View off', text: 'GROTBC only; nothing more is worked out.', keys: [['F', 'on for this symbol'], ['⇧F', 'on for every symbol'], ['D', 'Gr Detail'], ['V', 'Gr Scope']] };
    const d = this._opts.extended.ipb.readFor === 'defence';
    return {
      mode: this._keptNow() ? 'Ext View on · every symbol' : 'Ext View on · this symbol',
      text: `${d ? "The en's options against you" : 'Your options against the threat'}: fields of fire, Key Gr, Apchs, air, decision.`,
      keys: this._extKeys(),
    };
  }

  /** [ ]: the threat now. */
  private _threatNotice(): KeyNoticeContent {
    const deg = Math.round(this._opts.extended.bearingDeg);
    return {
      mode: `Threat ${COMPASS[Math.round(deg / 45) % 8]} ${deg}°`,
      text: "The fire fan, the Apchs and the threat's view turn with it. Drag the Threat marker to a place; double-click it for the unit's front.",
      keys: [['[ ]', 'turn 15°'], ['⇧[ ⇧]', 'turn 45°'], ['X', this._opts.extended.ipb.readFor === 'defence' ? 'your options' : "the en's options"], ['F', 'close']],
    };
  }

  /**
   * Where the threat is, for the Extended View: `{ threat: 'front' | 'bearing' | 'point' | 'allRound', bearingDeg, at:
   * [longitude, latitude], sectorDeg }`, any of them. `front` is the unit's front (`footprint.bearingDeg`), the default;
   * dragging the threat marker on the map sets `point`. Kept in the settings.
   */
  setThreat(t: { threat?: OcokaThreatMode; bearingDeg?: number; at?: [number, number] | null; sectorDeg?: number }): void {
    const o = { ...this._opts.extended };
    if (t.threat !== undefined) o.threat = t.threat;
    if (t.bearingDeg !== undefined) o.bearingDeg = t.bearingDeg;
    if (t.at !== undefined) o.at = t.at;
    if (t.sectorDeg !== undefined) o.sectorDeg = t.sectorDeg;
    this.setOptions({ extended: o });
    const now = this._opts.extended;
    for (const k of ['threat', 'bearingDeg', 'at', 'sectorDeg'] as const) if (t[k] !== undefined) setSetting(['groundGuide', 'extended', k], now[k]);
  }

  /** Turn the threat by `deg` (the [ and ] keys) from the bearing in force, which becomes a set bearing. */
  turnThreat(deg: number): void {
    const o = this._opts.extended;
    const from = o.threat === 'bearing' ? o.bearingDeg : o.threat === 'point' && this._lastExt ? this._lastExt.threat.bearingDeg : this._opts.footprint.bearingDeg;
    this.setThreat({ threat: 'bearing', bearingDeg: Math.round((((from + deg) % 360) + 360) % 360) });
  }

  /** Where a symbol's weapon ranges come from (default: the `Rng` field of MS/Data/Symbols.json); a host with its own catalogue sets its own. */
  setRangeLookup(fn: ((catalogKey: string) => { rng: unknown; name?: string | null } | null | undefined) | null): void {
    this._rangeLookup = fn ?? DEFAULT_RANGE_LOOKUP;
    this._refreshLive();
  }

  /**
   * The Extended View's reading at a map point (`[lng, lat]`, an ArcGIS point or any geometry): observation and fields of fire
   * toward the threat, the obstacle in front and whether fire covers it, the highest ground and the ITG candidates in
   * view, the straight ways out, the month's visibility and the light; `map: true` adds the approaches, the threat's
   * view and the better position. Works whether or not F is on (a host asks for it). Waits for the tiles. `sidc` picks the weapon
   * (its `Rng`) and the mode; `threatDeg` overrides the threat for this reading. Null when the guide is off or the
   * bundle has no elevation there. Sight is a chance, not a fact: say "may be seen" and check on the ground.
   */
  async extendedAround(
    point: any,
    opts: { sidc?: string | null; profile?: GroundGuideProfile; radiusKm?: number; threatDeg?: number; picture?: boolean; map?: boolean; frontageM?: number } = {},
  ): Promise<GroundGuideOcoka | null> {
    const ll = this._lngLatOf(point);
    const m = this._manifest;
    const L = this._sectionLayers();
    if (!ll || !this._cache || !m || !L.elevHi || !L.elevLo) return null;
    const z = m.zoom.max;
    const at = lngLatToMercator(ll[0], ll[1]) as MercXY;
    const sidc = opts.sidc ?? this._activeSidc;
    const profile = opts.profile ?? (opts.sidc ? this.resolveProfile(opts.sidc) : null) ?? this._activeProfile ?? this._lastArmedProfile ?? 'dismounted';
    const radiusKm = Math.min(10, Math.max(1, opts.radiusKm ?? this._opts.extended.radiusKm));
    const reach = (radiusKm * 1000 + 600) / Math.cos((ll[1] * Math.PI) / 180);
    const a = mercatorToTilePixel(at[0] - reach, at[1] + reach, z, m.tileSize);
    const b = mercatorToTilePixel(at[0] + reach, at[1] - reach, z, m.tileSize);
    for (let ty = a.ty; ty <= b.ty; ty++) {
      for (let tx = a.tx; tx <= b.tx; tx++) {
        for (const layer of [this._layerNames(profile).cls, L.elevHi, L.elevLo, L.bld]) if (layer) this._cache.request(layer, z, tx, ty);
      }
    }
    this._visibility?.get(); // starts the month's visibility grid if it is not in memory
    await Promise.all([this._tilesSettled(10000), this._features?.whenReady(at, radiusKm * 1000)]);
    for (let i = 0; i < 20 && this._visibility && this._visibility.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 150));
    this._extTick++;
    const over = { radiusKm, ...(opts.threatDeg !== undefined ? { threat: 'bearing' as const, bearingDeg: opts.threatDeg } : {}) };
    const r = this._readExt(at, profile, sidc, opts.picture === true, over);
    const rd = this._extRead;
    if (r && rd && opts.map) {
      // `map: true`: the fan, the threat's view, the lines of sight, the avenues and the better position, as geometry.
      const args = this._extArgs({ grid: rd.grid, ox: rd.ox, oy: rd.oy, at, lngLat: [ll[0], ll[1]], profile, reading: r, frontageM: opts.frontageM ?? DEFAULT_FRONTAGE_M }, { ...this._opts.extended, ...over });
      return { ...r, sight: ocokaSight(args), plan: ocokaPlan(args) };
    }
    return r;
  }

  /**
   * The Extended View as plain lines (what Copy as Text adds under the GROTBC brief while F is on), for a point as
   * `extendedAround` takes it: Obsn & Fd of Fire, the threat's view, the better position, the obstacle toward the
   * threat, concealment in crops, Key Gr ranked and the approaches from the threat with their chokepoints for
   * `frontageM` (100 m when not given).
   */
  async extendedText(point: any, opts: { sidc?: string | null; profile?: GroundGuideProfile; radiusKm?: number; threatDeg?: number; frontageM?: number } = {}): Promise<string[] | null> {
    const o = await this.extendedAround(point, { ...opts, map: true });
    if (!o) return null;
    const profile = opts.profile ?? (opts.sidc ? this.resolveProfile(opts.sidc) : null) ?? this._activeProfile ?? this._lastArmedProfile ?? 'dismounted';
    return extendedText({ ...this._blank('ok', profile, ''), ext: o, extended: true });
  }

  /** The live reading at the point being placed (the cursor, for lines and areas), while the Extended View is on. */
  private _extNear(geometry: any, sidc: string | null, v: GroundGuideVerdict): GroundGuideOcoka | null {
    if (v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt') return null;
    const at = geometry?.type === 'point' ? toMercatorShape(geometry)?.parts[0]?.[0] : this._pointerMerc();
    if (!at) return null;
    // The viewshed picture costs 6 to 8 ms: only while the Detail shows the tab that draws it.
    const r = this._readExt([at[0], at[1]], v.profile, sidc, this._briefOpen && this._detail.tab === 'XF');
    const rd = this._extRead;
    if (!r || !rd) return r;
    this._lastExt = r;
    // The map products belong to this spot, this threat and this frontage: shown once they are worked out.
    const frontageM = v.footprint?.frontageM || DEFAULT_FRONTAGE_M;
    const key = `${rd.key}|${frontageM}`;
    this._extCtx = { key, grid: rd.grid, ox: rd.ox, oy: rd.oy, at: [at[0], at[1]], lngLat: r.lngLat, profile: v.profile, reading: r, frontageM };
    if (this._extOverlayKind() === 'ipb') this._extOverlaySoon(250); // the IPB area follows the spot once the cursor rests
    this._apchAsk([at[0], at[1]], sidc); // the avenues' area follows the spot, once per area
    r.sight = this._extSightKey === key ? this._extSight : null;
    r.plan = this._extPlanKey === key ? this._extPlan : null;
    r.ipbApch = this._apchViewNow();
    this._extMapSoon();
    return r;
  }

  /** Read the Extended View at a point from the tiles in memory (shared by the live card and `extendedAround`). A reading is kept per 30 m cell. */
  private _readExt(at: MercXY, profile: GroundGuideProfile, sidc: string | null | undefined, picture: boolean, over: Partial<GroundGuideOptions['extended']> = {}): GroundGuideOcoka | null {
    const m = this._manifest;
    const cache = this._cache;
    const L = this._sectionLayers();
    if (!m || !cache || !L.elevHi || !L.elevLo || profile === 'exempt') return null;
    const o = { ...this._opts.extended, ...over };
    const z = m.zoom.max;
    const ts = m.tileSize;
    const [lon, lat] = mercatorToLngLat(at[0], at[1]);
    const [cx, cy] = mercToPx(at[0], at[1], z, ts);
    const n = 2 ** z;
    const peek = (layer: string, x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? null : cache.peek(layer, z, x, y));
    let reachM = o.radiusKm * 1000;
    if (o.threat === 'point' && o.at) {
      // The threat's place inside the ground read (up to 10 km off), for its own view and the avenues from it.
      const t = lngLatToMercator(o.at[0], o.at[1]);
      const d = Math.hypot(t[0] - at[0], t[1] - at[1]) * Math.cos((lat * Math.PI) / 180);
      if (d <= 10000) reachM = Math.max(reachM, d + 600);
    }
    const grid = this._extLive.grid(peek, { cls: this._layerNames(profile).cls, elevHi: L.elevHi, elevLo: L.elevLo, bld: L.bld }, z, ts, lat, cx, cy, reachM / mPerPx(lat, z, ts) + 4, this._extTick);
    const catKey = catalogKey(sidc);
    const month = resolveMonth(this._opts.going.month);
    const night = this._opts.speed.light === 'night';
    const front = this._opts.footprint.bearingDeg;
    const key = [Math.floor(cx), Math.floor(cy), profile, catKey ?? '', o.threat, o.bearingDeg, o.sectorDeg, o.at ? o.at.join(',') : '', front, o.radiusKm, o.eye, o.surface, month, night, picture, this._visibility?.state ?? ''].join('|');
    this._extRead = { key, grid, ox: cx - grid.px0, oy: cy - grid.py0 };
    const hit = this._extLive.recall(key);
    if (hit) return hit;
    const found = catKey ? this._rangeLookup(catKey) : null;
    const weapon = weaponOf(found?.rng);
    const cands = this._opts.itg.enabled && this._features ? this._features.candidatesNear(at, o.radiusKm * 1000, 4, 1) : { list: [], pending: false };
    const r = readOcoka({
      grid,
      ox: cx - grid.px0,
      oy: cy - grid.py0,
      at,
      lngLat: [lon, lat],
      profile,
      going: this._profile(profile),
      classLabel: (c) => plainLabel(this._rules?.classes?.[String(c)]?.label ?? '') || `Class ${c}`,
      weapon,
      weaponLabel: weapon.fromSymbol ? (found?.name ?? 'Weapon') : 'Small Arms',
      opts: o,
      frontDeg: front,
      threatAt: o.at ? (lngLatToMercator(o.at[0], o.at[1]) as MercXY) : null,
      month,
      night,
      candidates: cands.list,
      candidatesPending: cands.pending,
      visibility: this._visibility?.get() ?? null,
      picture,
    });
    if (r && !r.pending) this._extLive.remember(key, r);
    return r;
  }

  // ── Extended View map products ───────────────────────────────────────────────────────────────────────────────────────────

  private _extArgs(c: { grid: OcokaGrid; ox: number; oy: number; at: MercXY; lngLat: [number, number]; profile: GroundGuideProfile; reading: GroundGuideOcoka; frontageM: number }, o = this._opts.extended): OcokaMapArgs {
    return {
      grid: c.grid,
      ox: c.ox,
      oy: c.oy,
      at: c.at,
      lngLat: c.lngLat,
      profile: c.profile,
      going: this._profile(c.profile),
      classLabel: (cls) => plainLabel(this._rules?.classes?.[String(cls)]?.label ?? '') || `Class ${cls}`,
      reading: c.reading,
      opts: o,
      threatAt: o.at ? (lngLatToMercator(o.at[0], o.at[1]) as MercXY) : null,
      frontageM: c.frontageM,
    };
  }

  /**
   * Draw the Extended View's products on the map soon: the fan, the lines of sight and the threat's view follow the
   * cursor (at most every 60 ms); the approaches and the better position are worked out once the cursor has rested for 220 ms.
   */
  private _extMapSoon(): void {
    const o = this._opts.extended;
    const c = this._extCtx;
    const viewOver = this._extOverlayKind() === 'view';
    if (!c || !(o.mapFan || o.mapEnemy || o.mapSight || o.mapApproaches || o.mapBetter || viewOver)) return this._extMapClear();
    if (this._extSightTimer === null) {
      this._extSightTimer = setTimeout(() => {
        this._extSightTimer = null;
        this._extDraw(false);
      }, 60);
    }
    if (this._extPlanTimer !== null) clearTimeout(this._extPlanTimer);
    this._extPlanTimer =
      (c.key !== this._extPlanKey && (o.mapApproaches || o.mapBetter)) || (viewOver && c.key !== this._extViewKey)
        ? setTimeout(() => {
            this._extPlanTimer = null;
            this._extDraw(true);
          }, 220)
        : null;
  }

  private _extDraw(withPlan: boolean): void {
    const c = this._extCtx;
    const o = this._opts.extended;
    if (!c || !this.isActive || !this._ext || (!this._lastDetail && !this._extPin)) return this._extMapClear();
    let refresh = false;
    try {
      const args = this._extArgs(c);
      if (this._extSightKey !== c.key) {
        this._extSight = ocokaSight(args);
        this._extSightKey = c.key;
        refresh = !!this._extSight.enemy; // the card says whether the threat sees the position
      }
      if (withPlan && this._extPlanKey !== c.key && (o.mapApproaches || o.mapBetter)) {
        this._extPlan = ocokaPlan(args);
        this._extPlanKey = c.key;
        refresh = true;
      }
      // The overlay's view from the position: gone while the cursor moves, drawn again where it rests.
      if (this._extOverlayKind() === 'view' && this._extViewKey !== c.key) {
        if (withPlan) {
          this._extViewKey = c.key;
          const r = c.reading;
          this._extMap.setOverlayLabels(o.ipb.labels !== 'off');
          this._extMap.showOverlay(ocokaViewshed({ grid: c.grid, ox: c.ox, oy: c.oy, at: c.at, kind: 'view', eyeM: r.eyeM, targetM: 1.7, radiusM: r.radiusM, month: r.month, surface: r.surface }));
        } else if (this._extViewKey !== '') {
          this._extViewKey = '';
          this._extMap.showOverlay(null);
        }
      }
    } catch (err) {
      console.error('[Ground Guide] Extended View map products', err);
      return;
    }
    const plan = this._extPlanKey === c.key ? this._extPlan : null;
    const drawn = `${c.key}|${plan ? 1 : 0}|${o.mapFan}${o.mapEnemy}${o.mapSight}${o.mapApproaches}${o.mapBetter}${this._apchOn()}|${this._extMap.overlayKind ?? ''}|${o.ipb.labels}`;
    if (drawn !== this._extDrawnKey) {
      this._extDrawnKey = drawn;
      // The single approach path gives way to the IPB avenues when they are on (tab 3 says which is shown).
      this._extMap.show(c.at, this._extSight, plan, { fan: o.mapFan, enemy: o.mapEnemy, sight: o.mapSight, avenues: o.mapApproaches && !this._apchOn(), better: o.mapBetter, labels: o.ipb.labels !== 'off' });
    }
    if (refresh) this._refreshLive(); // the cards name what the map now shows
  }

  private _extMapClear(): void {
    if (this._extSightTimer !== null) clearTimeout(this._extSightTimer);
    if (this._extPlanTimer !== null) clearTimeout(this._extPlanTimer);
    this._extSightTimer = this._extPlanTimer = null;
    this._extCtx = null;
    this._extDrawnKey = '';
    this._extMap.hide();
    if (this._extViewKey !== '') {
      // Nothing is being placed: the view from the position goes with it (the threat's view stays).
      this._extViewKey = '';
      if (this._extOverlayKind() !== 'threat') this._extMap.showOverlay(null);
    }
  }

  /**
   * J in the Extended View: place the symbol at the better position the map shows (the green ring), the way S places it on
   * usable ground. False when there is none, or it is not on ground the GROTBC rule accepts.
   */
  takeBetter(): boolean {
    const d = this._lastDetail;
    const c = this._extCtx;
    const b = c && this._extPlanKey === c.key ? this._extPlan?.better : null;
    const no = (msg: string): boolean => {
      this._notice({ mode: msg, warn: true, text: 'J takes the better Posn when the map shows one.', keys: this._ext ? this._extKeys() : [['F', 'Ext View']] }, msg, 2600);
      return false;
    };
    if (!this.isActive || !d || d.geometry?.type !== 'point' || !b) return no('No better Posn to take here');
    const view: any = this._getView?.();
    const target = this._withMerc(d.geometry, b.at);
    const v = target ? this.evaluateGeometry(target, d.sidc) : null;
    if (!target || !v || this._snapRank(v) < 0) return no('The better Posn is not on usable Gr');
    const px = this._settleOnScreen(view, target, d.sidc);
    if (!px) return no('Cannot place the symbol there on this view');
    EngineLogger.success(ENGINE, `Moved ${fmtDistance(b.distanceM)} ${b.compass} to better fields of fire (${b.hereGrade} to ${b.grade})`);
    this._notice({ mode: 'Placed at the better Posn', text: `${fmtDistance(b.distanceM)} ${b.compass}: fields of fire ${b.hereGrade} to ${b.grade}. Ctrl+Z undoes the placement.`, keys: this._extKeys() }, null);
    this._emit('ground-guide-better', { at: b.at, distanceM: b.distanceM, compass: b.compass, grade: b.grade, from: b.hereGrade });
    // The armed symbol's own click handler finishes the draw at this spot, as for the S quick fix.
    this._clickAt(view, px.x, px.y);
    return true;
  }

  /** Show, hide and place the threat marker: on while the guide is on with a bundle, the Extended View is on and `extended.marker` is set. */
  private _syncThreat(): void {
    const o = this._opts.extended;
    // The marker shows in the Extended View, and while the rail reads an AOR (the approaches come from the threat's side).
    const aor = this._opts.aor.scale === 'aor' && this._scope.isShown;
    if (!(this._enabled && this._manifest !== null && this._opts.mode !== 'off' && (this._ext || aor) && o.marker)) {
      this._threat.hide();
      return;
    }
    const pt = o.threat === 'point' && !!o.at;
    let bearing = o.threat === 'bearing' ? o.bearingDeg : this._opts.footprint.bearingDeg;
    if (pt) {
      // Docked because its place is off the view, the arrow points from the middle of the view to the place.
      const view: any = this._getView?.();
      const c = view?.center ? toMercatorShape(view.center)?.parts[0]?.[0] : null;
      const t = lngLatToMercator(o.at![0], o.at![1]);
      if (c) bearing = ((Math.atan2(t[0] - c[0], t[1] - c[1]) * 180) / Math.PI + 360) % 360;
    }
    this._threat.show({ mode: o.threat === 'point' && !pt ? 'front' : o.threat, bearingDeg: bearing, at: o.at }, this._north);
  }

  private _lngLatToScreen(ll: [number, number]): { x: number; y: number } | null {
    const view: any = this._getView?.();
    const c = view?.center;
    if (!c || typeof c.clone !== 'function' || typeof view.toScreen !== 'function') return null;
    const xy = fromMercatorXY(c, lngLatToMercator(ll[0], ll[1]));
    if (!xy) return null;
    try {
      const g = c.clone();
      g.x = xy[0];
      g.y = xy[1];
      const s = view.toScreen(g);
      return s && Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : null;
    } catch {
      return null;
    }
  }

  private _screenToLngLat(x: number, y: number): [number, number] | null {
    const view: any = this._getView?.();
    try {
      const mp = view?.toMap?.({ x, y });
      const p = mp ? toMercatorShape(mp)?.parts[0]?.[0] : null;
      return p ? mercatorToLngLat(p[0], p[1]) : null;
    } catch {
      return null;
    }
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
      this._indicators.show(v.indicators, verdictTone(v));
    } else {
      this._indicators.hide();
    }
    if (this._opts.footprint.outline && this.isActive && v.footprint) {
      this._indicators.showFootprint(v.footprint.ring, v.spacing?.conflicts.map((c) => c.ring) ?? []);
      this._badge.setKeepClear(this._frontageOnScreen(v.footprint.ring));
    } else {
      this._indicators.hideFootprint();
      this._badge.setKeepClear(null);
    }
    this._publish(v);
    if (this._lastDetail) {
      this._scopeLive = v;
      this._scopeSoon();
    }
  }

  /**
   * The frontage drawn on the map as a box of offsets from the symbol on screen (CSS px), for the card to keep clear
   * of (user, 2026-11-08: the card's corner hid the frontage line, its NO-GO end included). Offsets, because the card
   * follows the cursor between verdicts and the symbol moves with it. A disc is boxed by its Mercator bounds. Null
   * when it cannot be worked out.
   */
  private _frontageOnScreen(ring: MercXY[]): { l: number; t: number; r: number; b: number } | null {
    const view: any = this._getView?.();
    const g = this._lastDetail?.geometry;
    if (!view?.toScreen || g?.type !== 'point' || ring.length < 2) return null;
    let pts = ring;
    if (ring.length > 8) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of ring) ((x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y)));
      pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    const screen = (p: any): { x: number; y: number } | null => {
      try {
        const s = p ? view.toScreen(p) : null;
        return s && Number.isFinite(s.x) && Number.isFinite(s.y) ? s : null;
      } catch {
        return null;
      }
    };
    const o = screen(g);
    if (!o) return null;
    let l = 0, t = 0, r = 0, b = 0;
    for (const xy of pts) {
      const s = screen(this._withMerc(g, xy));
      if (!s) return null;
      ((l = Math.min(l, s.x - o.x)), (r = Math.max(r, s.x - o.x)), (t = Math.min(t, s.y - o.y)), (b = Math.max(b, s.y - o.y)));
    }
    return { l, t, r, b };
  }

  /** The card shows figures (percent, distances, gaps) the event key does not carry, so it refreshes on its own key. */
  private _showBadge(v: GroundGuideVerdict): void {
    const key = [
      v.verdict, v.message, v.detail ?? '', v.loading ? 1 : 0, Math.round(v.fraction * 100),
      Math.round(v.nearest?.distanceM ?? -1), v.nearest?.compass ?? '',
      v.spacing?.status ?? '', Math.round(v.spacing?.nearestGapM ?? -1), v.snappable ? 1 : 0,
      v.clear ? (v.clear.distanceM === null ? 'none' : `${fmtDistance(v.clear.distanceM)}${v.clear.compass}${Math.round(v.clear.bearingDeg! / 3)}`) : '',
      v.ground?.candidates.map((c) => `${c.kind}${c.level}${Math.round(c.distanceM / 50)}${c.compass}`).join(',') ?? '',
      goingKey(v.going), v.briefKey ? 1 : 0,
      populationKey(v.population),
      trafficKey(v.traffic),
      speedKey(v.speed),
      coverKey(v.cover),
      sectionsKey(v.sections),
      v.extended ?? '', extKey(v.ext),
      // The frontage strip (shown only while some of it is in NO-GO): the same share can sit at the other end.
      v.fraction > 0 ? (v.footprint?.front?.map((b) => `${Math.round(b.nogo * 5)}${b.rest?.[0] ?? 'u'}`).join('') ?? '') : '',
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
    this._extTick++; // a tile the Extended View's grid was missing may have arrived
    const extKind = this._extOverlayKind();
    if (extKind === 'threat' || extKind === 'ipb') this._extOverlaySoon(300);
    if (this._apchWaiting) this._apchSoon(250);
    // Feature tiles the air reading wanted have arrived: read the air again (obstructions, lines, existing helipads).
    if (!terrain && this._airFeaturesPending && this._apch) {
      this._airFeaturesPending = false;
      this._fireKey = '';
      this._ipbFireSoon(300);
    }
    // The weather grids load on first use: Annex A is read again when one arrives (a lookup, no tiles).
    const av = this._apch?.view;
    if (av?.wx && av.wx.rows.some((r) => r.status === 'na' && /no (visibility|climate) data/.test(r.value))) {
      const wx = this._ipbWxFor(av);
      if (wx && wx.rows.filter((r) => r.status === 'na').length < av.wx.rows.filter((r) => r.status === 'na').length) {
        av.wx = wx;
        this._refreshLive();
      }
    }
    if (this._scope.isShown) {
      this._scopeTick++; // the rail's map may have been waiting on it
      this._scopeSoon();
    }
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
          if (this._extOverlayKind() === 'ipb') this._extOverlaySoon(250); // a new area once the map rests
          // Nothing placed and no rail reading a spot: the avenues read round the map centre once it rests.
          if (this._apchOn() && !this._extCtx && !this._scope.wanted && view.center) this._apchAsk([view.center.x, view.center.y], null);
          if (this._apch && this._apchOn()) this._apchDraw(); // the labels are decluttered for the new zoom
          this._scopeAfterPan(view);
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
        this._threat.setNorth(north);
        this._north = north;
        this._scopeSoon(); // the rail's map turns with the view
      },
      { initial: true },
    );
    // The threat marker rides on its place as the map moves.
    this._threatHandle = reactiveUtils.watch(
      () => [view.extent, view.type === '3d' ? view.camera : null],
      () => this._threat.reflow(),
    );
    this._syncThreat();
    this._syncScope();
  }

  /**
   * The view came to rest: a pan of more than a fifth of the screen lets go of the symbol just placed (the rail goes to
   * the map centre, unless a symbol is being placed or is selected); the map centre is read again.
   */
  private _scopeAfterPan(view: any): void {
    const p = this._scopePlaced;
    if (p?.centre && view?.center && this._extPin?.graphic !== p.graphic) {
      const now = toMercatorShape(view.center)?.parts[0]?.[0];
      const res = this._viewResolution();
      const w = (view.width ?? 0) * (res ?? 0);
      if (now && w > 0 && Math.hypot(now[0] - p.centre[0], now[1] - p.centre[1]) > w / 5) this._scopePlaced = null;
    }
    this._scopeSoon();
  }

  private _unbindView(): void {
    this._stationaryHandle?.remove();
    this._stationaryHandle = null;
    this._northHandle?.remove();
    this._northHandle = null;
    this._threatHandle?.remove();
    this._threatHandle = null;
    this._threat.destroy(); // it lives in the view's container: a new view gets a new one
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
    // The Extended View (user, 2026-11-12): F turns it on and off at any time the guide is on; while it is on, 1 2 3 open
    // its tabs, [ and ] turn the threat and J takes the better Posn. The GROTBC letters keep their keys (the user's
    // rule). With it off the digits, brackets and J are left alone for the app.
    const oDigit = /^Digit\d$/.test(e.code) && EXT_TABS.some((t) => EXT_TAB_KEY[t] === e.code.slice(5)) ? Number(e.code.slice(5)) : 0;
    const oTurn = e.code === 'BracketRight' ? 1 : e.code === 'BracketLeft' ? -1 : 0;
    const oKey = this._opts.extended.keys && (k === 'f' || (this._ext && (k === 'j' || k === 'x' || oDigit > 0 || oTurn !== 0)));
    if ((k !== 's' && k !== 'p' && k !== 'd' && k !== 'h' && k !== 'v' && k !== 'escape' && !tabKey && !oKey) || e.ctrlKey || e.metaKey || e.altKey || (e.repeat && oTurn === 0)) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (oKey) {
      if (!this.isActive || (k !== 'f' && this._activeProfile === 'exempt')) return;
      e.preventDefault();
      if (k === 'f') {
        // F: on for the symbol being placed (and the next of its kind), or off. Shift+F: on and kept for every symbol.
        let msg: string;
        if (e.shiftKey) {
          this._setExt(true, true, true);
          msg = 'Ext View kept on for every symbol. F closes it.';
        } else {
          const on = this.toggleExtended();
          msg = !on
            ? 'Ext View off.'
            : this._keptNow()
              ? `Ext View on (kept): ${this._opts.extended.ipb.readFor === 'defence' ? "en's options" : 'your options'}, X the other side. 1 2 3 4 5 tabs, J better Posn. F closes it.`
              : `Ext View on for this symbol: ${this._opts.extended.ipb.readFor === 'defence' ? "en's options" : 'your options'}, X the other side. 1 2 3 4 5 tabs, J better Posn. Shift+F keeps it.`;
        }
        this._notice(this._extNotice(), msg, 2600);
      } else if (k === 'j') {
        this.takeBetter();
      } else if (k === 'x') {
        this.toggleReadFor(); // X: the enemy's options against you, or yours against the threat
      } else if (oTurn !== 0) {
        this.turnThreat(oTurn * (e.shiftKey ? 45 : 15));
        this._notice(this._threatNotice(), null);
      } else if (this._opts.card.briefKey) {
        const tab = EXT_TABS.find((t) => EXT_TAB_KEY[t] === String(oDigit)) ?? EXT_TABS[0];
        if (this._briefOpen && this._detail.tab === tab) {
          if (e.shiftKey) this._detail.prevPage();
          else this._detail.nextPage();
        } else this._toggleBrief(true, tab);
      }
      return;
    }
    if (k === 'v') {
      // V shows or hides the Gr Scope rail at any time the guide is on, drawing or not (user, 2026-11-08). Plain V is
      // free in the app; Ctrl+V stays paste (modifiers return above).
      if (!this._opts.scope.enabled || !this.isActive) return;
      e.preventDefault();
      if (e.shiftKey && this._opts.aor.keys) {
        // Shift+V switches the rail between Spot and AOR (user, 2026-11-11), showing it if it was hidden.
        this.setScopeScale();
        const aor = this._opts.aor.scale === 'aor';
        this._notice(
          {
            mode: `Gr Scope: ${aor ? 'AOR' : 'Spot'}`,
            text: aor ? 'The area of ops read as Gr and Weather: approaches, lines of def, the MITG, the MSR.' : 'The ground round the symbol, with range rings and the frontage.',
            keys: [['⇧V', aor ? 'Spot scale' : 'AOR scale'], ...(aor ? ([['D', 'Apch sheets']] as KeyNoticeKey[]) : []), ['V', 'hide the rail']],
          },
          aor ? 'Gr Scope: AOR. Shift+V for Spot, D for the apch sheets.' : 'Gr Scope: Spot. Shift+V for AOR.',
          1800,
        );
        return;
      }
      this.showScope(!this._scope.wanted);
      const shown = this._scope.wanted;
      const aor = this._opts.aor.scale === 'aor';
      this._notice(
        shown
          ? { mode: 'Gr Scope shown', text: aor ? 'The rail reads the area of ops (AOR scale).' : 'The rail shows the ground round the symbol; its legend lines are the layer switches.', keys: [['V', 'hide'], ['⇧V', aor ? 'Spot scale' : 'AOR scale'], ...(aor ? ([['D', 'Apch sheets']] as KeyNoticeKey[]) : [])] }
          : { mode: 'Gr Scope hidden', keys: [['V', 'show'], ['⇧V', 'show at the AOR scale']] },
        null,
      );
      return;
    }
    if (k === 'escape' && this._aorSheet.isOpen) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._aorSheet.close();
      return;
    }
    if (k === 'd' && this._opts.aor.keys && this._opts.aor.scale === 'aor' && this._scope.isShown) {
      // D in the AOR scale opens the approach sheets beside the rail (the letters still open the Ground Detail's tabs).
      e.preventDefault();
      this._toggleAorSheet(!this._aorSheet.isOpen);
      return;
    }
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
      const chip = this._badge.toggleHint();
      this._notice(
        chip
          ? { mode: 'Card as a chip', text: 'GO / SLOW-GO / NO-GO only, so the map under the symbol shows.', keys: [['H', 'card back'], ['D', 'Gr Detail'], ['S', 'clear Gr']] }
          : { mode: 'Card back', keys: [['H', 'chip only'], ['D', 'Gr Detail'], ['S', 'clear Gr']] },
        null,
      );
      return;
    }
    if (k === 'p') {
      if (!this._opts.profileKey || !this._lastDetail || this._activeProfile === 'exempt') return;
      e.preventDefault();
      const over = this.cycleProfile();
      const now = over ?? resolveProfile(this._activeSidc, this._rules);
      this._notice({ mode: `Judged for ${this._rules?.profiles?.[now]?.label ?? now}`, text: over ? 'Set by hand for this symbol.' : "The symbol's own mode.", keys: [['P', 'next mode'], ['S', 'clear Gr for it']] }, null);
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
    // With the Extended View on the overlay paints what can be seen (`extended.overlay`), unless it is set to keep the going.
    const lensOwn = this._ext && this._extHere() && this._opts.mode !== 'off' && this._opts.extended.overlay !== 'going';
    this._extOverlaySoon(0);
    const want = this._enabled && this._manifest !== null && this._rules !== null && this._opts.overlay.enabled && !lensOwn;
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
