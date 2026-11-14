/**
 * GroundGuideTypes.ts
 *
 * Shared types for the Ground Guide — the optional "is this deployable
 * terrain?" check that runs while a symbol is drawn. See
 * MS/Docs/15-ground-guide.md for the bundle format these mirror.
 */

import type { GroundGuideTraffic, GroundGuideTrafficOptions } from './GroundGuideTrafficability';
import type { CoverRules, GroundGuideCover, GroundGuideCoverOptions } from './GroundGuideCover';
import type { GroundGuideSections, GroundGuideSectionsOptions } from './GroundGuideSections';
import type { RoadDensityRules } from './GroundGuideRoadDensity';
import type { GroundGuideSpeed, GroundGuideSpeedOptions } from './GroundGuideSpeed';
import type { OcokaFire, OcokaObservation, OcokaObstacleFront, OcokaWeapon, VisibilityReading, WayState } from './GroundGuideOcoka';

/**
 * Mobility class (mode) a symbol is evaluated as. `exempt` = never terrain-bound. The first five are in
 * every bundle; the rest come with bundle v2 (GROTBC). A bundle may define further modes of its own.
 */
export type GroundGuideProfile =
  | 'dismounted'
  | 'wheeled'
  | 'tracked'
  | 'vessel'
  | 'generic'
  | 'gun'
  | 'ad'
  | 'hls'
  | 'signals'
  | 'amphibious'
  | 'pack'
  | 'oversnow'
  | 'roadbound'
  | 'rail'
  | 'exempt';

export type GroundGuideVerdictKind =
  | 'ok'
  | 'near'
  | 'caution'
  | 'partial'
  | 'in'
  | 'unknown'
  | 'exempt'
  | 'off';

export type GroundGuideMode = 'off' | 'advise' | 'enforce';

/** A value `setOptions()` did not take as given: ignored (it was invalid) or moved into range. */
export interface GroundGuideOptionIssue {
  /** Setting path, e.g. `groundGuide.units`. */
  path: string;
  value: unknown;
  reason: string;
}

/** How distances are written in the advice: metres / kilometres, yards / miles, or metres / nautical miles. */
export type GroundGuideUnits = 'metric' | 'imperial' | 'nautical';

/** `manifest.json` at the bundle root. */
export interface TerrainManifest {
  format: 'pams-terrain-bundle';
  version: number;
  name?: string;
  crs?: string;
  tileSize: number;
  zoom: { min: number; max: number };
  /** [west, south, east, north] in WGS84 degrees. */
  bounds: [number, number, number, number];
  /** Metres per distance-layer unit (value × distScaleM = metres). */
  distScaleM: number;
  /** Layer names: `class`, `dist` (template with `{profile}`) and the v2 auxiliary layers (`soil`, `rci_dry`, `rci_wet`, `wet`, ...). */
  layers?: { class?: string; dist?: string; [name: string]: string | undefined };
  profiles: string[];
  built?: string;
  pipelineVersion?: string;
  rulesVersion?: string;
  /** Built from open data plus a local topographic geodatabase (adds sand / dunes / rocky ground / salt pan / dry riverbed classes). */
  hybrid?: boolean;
  /** Contains pixels derived from restricted data: do not redistribute without the owner's permission. */
  restricted?: boolean;
  /** Which country boundary clipped the data, and the drawable outline shipped with the bundle. */
  boundary?: {
    /** `official` = Survey of Pakistan depiction (all of Jammu & Kashmir), `osm` = stops at the LoC, `custom` = supplied. */
    source: 'official' | 'osm' | 'custom' | string;
    /** Path of the GeoJSON outline (outline, provinces, Line of Control, borders) inside the bundle, when shipped. */
    file?: string;
    note?: string;
  };
  sources?: Array<{ id: string; name?: string; licence?: string; sha256?: string }>;
  /** Bundle v2 extras (only the parts the engine reads are typed). */
  grotbc?: {
    /** Point and line features per z tile; `quant` tile-local units across a tile. */
    features?: { path: string; index: string; z: number; quant: number };
    /** Monthly climate normals on a coarse grid (WorldClim): `index` describes `data` (int16 layers). */
    climate?: { index: string; data: string };
    /** People on a ~1 km grid (population.py): header JSON and the uint16 layers file. */
    population?: { index: string; data: string; sources?: string[] };
  };
}

export interface TerrainClassDef {
  name: string;
  label: string;
  /** Optional one-sentence note on this ground, shown when no profile-specific reason is given. */
  note?: string;
  /** Bundle v2: GROTBC heading letters (G Ground, R Roads/tracks/rail, O Obstacles, T Trafficability, B Built-up, C Cover/concealment), e.g. "OC". */
  grotbc?: string;
  /** Bundle v2: obstacle origin. */
  origin?: 'natural' | 'man_made' | string;
  /** Bundle v2: obstacle kind (water, gradient, soft_ground, vegetation, structure, route, crossing, ...). */
  kind?: string;
}

export interface TerrainProfileRule {
  label?: string;
  /** Class codes that are no-go for this profile. */
  nogo?: number[];
  /** Class codes that are deployable with a warning. */
  caution?: number[];
  /** When set, every class NOT listed here is no-go (vessels need water). */
  requires?: number[];
  /**
   * Optional: class code → why that ground is no-go / difficult for this profile, one sentence
   * ("Tracks bog down in marsh and wetland soils."). Authored by the rule owner; the guide shows it
   * under the verdict and never writes any of its own.
   */
  why?: Record<string, string>;
  /** False: the distance layer carries no Marginal band (road- and rail-bound modes, a pixel or two wide). */
  marginal?: boolean;
}

/** `rules.json` at the bundle root. */
export interface TerrainRules {
  version?: string;
  classes: Record<string, TerrainClassDef>;
  profiles: Record<string, TerrainProfileRule>;
  /** Bundle v2: thin no-go lines (distributaries, walls, railways) the distance layers do not measure to. */
  marginalIgnore?: number[];
  profileOverrides?: {
    /** 2-digit 2525D symbol set → profile. */
    symbolSets?: Record<string, string>;
    /** `symbolSet:entityPrefix` → profile (entity prefix 2–6 digits). */
    entities?: Record<string, string>;
  };
  /**
   * 2-digit 2525D echelon code → ground footprint, overriding the doctrine table compiled
   * into GroundGuideFootprint.ts. Each range is `[min, max]` metres (or one number for a fixed value).
   */
  echelons?: Record<
    string,
    {
      name?: string;
      frontageM?: number | [number, number];
      depthM?: number | [number, number];
      gapM?: number | [number, number];
    }
  >;
  /** Bundle v2 doctrine numbers and codebooks (only the parts the engine reads are typed). */
  grotbc?: {
    /** Important Tactical Ground candidates (G): what each `ig` letter means, and the strong-candidate rule. */
    itg?: { reasons?: Record<string, { label: string }>; note?: string };
    /** Codebooks of the auxiliary layers (`soil`, `soilConfidence`, `wet`, ...): code -> label. */
    layers?: Record<string, Record<string, unknown>>;
    /** Card text per soil texture code: the going dry and after rain in words. */
    soilBearing?: Record<string, { dry?: string; wet?: string; note?: string }>;
    /** Cone index against vehicle cone index (rci_dry / rci_wet layers). */
    soilStrength?: SoilStrengthRules;
    /** C: four-way cover per class ([direct, indirect, ground, aerial], 0-3). */
    coverSplit?: CoverRules['coverSplit'];
    /** C: what each kind of river / canal bank gives (bank layer). */
    banks?: CoverRules['banks'];
    /** R: tankable road rule (class 60+ tankable, 50-59 limited) and the tanks behind it. */
    tankable?: { minClass?: number; limitedClass?: number; minWidthM?: number; transporterClass?: number };
    /** G: which feature kinds count as water sources. */
    water?: { kinds?: string[] };
    /** R: road network density bands (GroundGuideRoadDensity; defaults in the engine when absent). */
    roadDensity?: RoadDensityRules;
  };
}

/** rules.json `grotbc.soilStrength`: the vehicle cone index each mode needs, on fine-grained soil and on sand. */
export interface SoilStrengthRules {
  /** `[vci1, vci50]`: cone index to pass once / to carry a column. */
  vehicles: Record<string, { label: string; fine: [number, number]; coarse: [number, number] }>;
  /** Profile -> vehicle key; a profile not listed is not judged on soil (roads, rail, water, air). */
  byProfile: Record<string, string>;
  /** Largest cone index the layers store (127 = "127 or more"). */
  layerCap?: number;
  confidence?: { labels?: Record<string, string> };
}

/** How the footprint is oriented, since a placed symbol has no facing of its own. */
export type GroundGuideFacingMode =
  /** One rectangle, frontage across `bearingDeg`. */
  | 'fixed'
  /** Worst result of four facings (0°, 45°, 90°, 135° — a centred rectangle repeats every 180°). */
  | 'worst4'
  /** Orientation-free disc whose diameter is the frontage. */
  | 'circle';

/** Which end of an echelon's doctrinal range the footprint uses. */
export type GroundGuideFootprintSize = 'min' | 'mid' | 'max';

/** Echelon footprint: a unit is judged on the ground it occupies, not on its click point. */
export interface GroundGuideFootprintOptions {
  enabled: boolean;
  facing: GroundGuideFacingMode;
  /** Direction the frontage faces, degrees clockwise from north (used by `fixed`). */
  bearingDeg: number;
  size: GroundGuideFootprintSize;
  /** Draw the footprint on the map while placing. */
  outline: boolean;
  /** Compare against same-echelon symbols already on the map for the minimum intergap. */
  spacing: boolean;
}

/** Map overlay that paints the terrain bundle as go / caution / near / no-go. */
export interface GroundGuideOverlayOptions {
  enabled: boolean;
  /** Mobility profile to paint; `auto` follows the armed symbol (last armed one when idle). */
  profile: 'auto' | GroundGuideProfile;
  /** Layer opacity, 0–1. */
  opacity: number;
  /** Also draw the bundle's boundary outline (`manifest.boundary.file`): national outline, provinces, Line of Control. */
  boundary: boolean;
}

/** Lines drawn on the map from the symbol to the terrain that makes it undeployable. */
export interface GroundGuideIndicatorOptions {
  enabled: boolean;
}

export interface GroundGuideOptions {
  mode: GroundGuideMode;
  overlay: GroundGuideOverlayOptions;
  indicators: GroundGuideIndicatorOptions;
  footprint: GroundGuideFootprintOptions;
  /** Folder that holds manifest.json; '' disables the engine. */
  bundleUrl: string;
  /** Deployable samples closer than this to no-go yield `near`. */
  nearThresholdM: number;
  /** Line/area share of no-go samples at which the verdict becomes `partial`. */
  partialFraction: number;
  /** Verdicts refused by `enforce` mode. */
  blockOn: GroundGuideVerdictKind[];
  /** In `enforce` mode, holding Shift while clicking places the symbol anyway, stamped `overridden`. Off = a hard block. */
  allowOverride: boolean;
  showBadge: boolean;
  /**
   * Units for the distances in the card, messages, key and panel. Display only: the data, thresholds
   * (`nearThresholdM`) and event payloads stay in metres. One setting for the whole page.
   */
  units: GroundGuideUnits;
  /** Pressing S while drawing a point on bad ground places it at the nearest usable ground instead. */
  snapKey: boolean;
  /** Pressing P while drawing cycles which unit type the ground is judged for (auto, then each profile in the bundle) for that one draw. */
  profileKey: boolean;
  logVerdicts: boolean;
  cacheTiles: number;
  prefetchMarginTiles: number;
  /** Cap on samples per geometry; the step widens to stay under it. */
  maxSamples: number;
  /** Decode tiles and paint the overlay in a Web Worker (falls back to the main thread if unavailable). */
  useWorker: boolean;
  /** Important Tactical Ground (ITG) candidates near the cursor on the card (G, bundle v2 with ground features). */
  itg: GroundGuideItgOptions;
  /** Cross-country going, soil and movement freedom (T, bundle v2 with soil layers): how they are judged. */
  going: GroundGuideGoingOptions;
  /** Which going / soil / movement sections the card shows (each can be switched on alone, to compare). */
  card: GroundGuideCardOptions;
  /** People round the cursor (B, civil considerations; bundle v2 with a population grid). */
  population: GroundGuidePopulationOptions;
  /** T (Trafficability) on top of the going sections: road line, legend season controls, overlay and header that follow the season, compact card styles, rain rule. */
  traffic: GroundGuideTrafficOptions;
  /** C (Cover, Camouflage & Concealment): the four-way cover at the point and the nearest better (bundle v2 with the cc / bank layers). */
  cover: GroundGuideCoverOptions;
  /** G / R / B / W sections: terrain, relief, landform, water; route here and for the mode; buildings, huts, services; weather. */
  sections: GroundGuideSectionsOptions;
  /** T, Speed: cross-country and road speed for the symbol's mover, day / night, dry / after rain (MS/Data/MovementSpeeds.json). */
  speed: GroundGuideSpeedOptions;
  /** The Gr Scope rail (V): a side window docked at the edge of the map with the ground round the symbol. */
  scope: GroundGuideScopeOptions;
  /** The Extended View (F): Obsn & Fd of Fire, Key Gr and Approaches toward a threat, added to GROTBC while it is on. */
  extended: GroundGuideExtendedOptions;
  /** The Gr Scope rail's AOR scale (Shift+V): the area of ops read as an appreciation's Gr and Weather. */
  aor: GroundGuideAorOptions;
}

/**
 * The AOR scale of the Gr Scope rail (user, 2026-11-11; mockup ground-guide-aor-options.html): Shift+V switches the
 * rail between Spot (the ground round one symbol) and AOR (the area of ops: approaches ranked, lines of def lettered
 * W X Y Z with their roles, the MITG, bridges to prepare for demolition, MSR and laterals, NO-GO / SLOW-GO in Vs72's
 * marking). Every view option is kept and switched on the fly from the rail's foot, the settings or the API.
 */
export interface GroundGuideAorOptions {
  /** Shift+V switches the rail's scale; D opens the approach sheets while the AOR scale shows. */
  keys: boolean;
  /** The scale the rail shows. */
  scale: 'spot' | 'aor';
  /** A: deductions under the map; B: sand model (names on a taller map); C: appreciation tables. */
  layout: 'deductions' | 'model' | 'appreciation';
  /** Trace: Vs72's green / black marking on a talc-trace colour. Dark: the Spot rail's colours. */
  style: 'trace' | 'dark';
  /** North up (turns with the view, as the Spot rail) or threat up (the approaches come from the top). */
  orient: 'north' | 'threat';
  /**
   * Where the AOR's outline comes from: `boundaries` the Boundary symbols either side of the MITG, `box` a box dragged on
   * the map (`box`), `echelon` the echelon's frontage and depth facing the threat. A missing box or pair of bdys falls
   * back to the echelon frame, and the rail says so.
   */
  source: 'boundaries' | 'box' | 'echelon';
  /** The dragged box, [west, south, east, north] in degrees; null until one is drawn. */
  box: [number, number, number, number] | null;
  /** The echelon the AOR is for: `auto` from the symbol read (Coy / Bn / Bde), else Bn. Sets the frame, the threat's corridor (two up) and the frontage test. */
  echelon: 'auto' | 'coy' | 'bn' | 'bde';
  /** How far forward of the AOR the threat's approaches start when the threat is not a place on the map, km. */
  leadKm: number;
  /** Width the threat's corridor needs, m; 0 = two echelons up from the AOR's (Coy 1 km, Bn 2 km, Bde 4 km: a proposal). */
  corridorM: number;
  /** The mover the going is read for (the threat's armour by default). */
  profile: GroundGuideProfile;
}

/**
 * Where the threat is, for fields of fire, the obstacle in front and the dead ground. `front`: the unit's front
 * (`footprint.bearingDeg`). `bearing`: `extended.bearingDeg` (the [ and ] keys turn it). `point`: toward `extended.at`,
 * a place on the map (drag the threat marker to it). `allRound`: every direction.
 */
export type OcokaThreatMode = 'front' | 'bearing' | 'point' | 'allRound';
export type OcokaEye = 'auto' | 'standing' | 'prone' | 'vehicle' | 'post';

/**
 * The Extended View (user, 2026-11-12; it replaced the separate OCOKA lens of 2026-11-10). F turns it on and off; it
 * is not kept in the settings: it starts off and goes off with the guide, so the sight and approach sums only run when
 * asked for. While on, the Ground Detail gains Obsn & Fd of Fire, Key Gr and Approaches (keys 1 2 3, before the
 * Legend), the O and C tabs a tile each on the threat's side, the cursor card a short block, the map the threat marker,
 * the fire fan, lines of sight, the approaches and the better position, and the Gr Scope rail its Extended mode. Read
 * from the terrain bundle in the browser (the OCOKA engine: GroundGuideOcoka.ts); figures and rules are in
 * MS/Data/OcokaDoctrine.json and the `Rng` field of MS/Data/Symbols.json. Enforce mode stays on the GROTBC GO / NO-GO
 * rule: an Extended View reading is a judgement and never blocks a placement. These options shape it.
 */
/**
 * The IPB combined obstacle overlay of the Extended View (2026-11-14; IPB_Plan.md §6.1, MS/Data/IpbDoctrine.json).
 * GO / SLOW-GO / NO-GO by the IPB book's criteria only, with "not assessed" where the bundle cannot test a criterion.
 */
export interface GroundGuideIpbOptions {
  /** Whose movement is read: the enemy's toward the position (`defence`, from the threat) or own toward the enemy (`attack`). */
  readFor: 'defence' | 'attack';
  /** The book's kind of force. `auto`: armour for the enemy (defence); the symbol's own for an attack. */
  mover: 'auto' | 'armour' | 'mech' | 'dismounted';
  /** The terrain pamphlets' season rules (Rann June-November, above 2500 m in winter, snow slopes): in the coding or as notes. */
  season: 'coding' | 'notes';
  /** AVLB span, m: a gap wider than this cannot be spanned (18 m typical; confirm with engineers). */
  avlbSpanM: number;
  /** Paint: the book's Trace hatch (crosshatch NO-GO, lines SLOW-GO), a soft tint, or ATP 2-01.3's green. */
  paint: 'hatch' | 'soft' | 'atp';
  /**
   * Mobility corridors and avenues of approach (IPB_Plan.md §6.2; 2026-11-14): read over the HQ's area facing the threat,
   * drawn on the map as the MS attack arrows, in tab 3 and on the rail. Off: not worked out, tab 3 keeps the single
   * approach path.
   */
  apchs: boolean;
  /** The HQ that reads (book p 7: corridors two levels down, avenues one): `auto` from the symbol's echelon (Bn and below read with the Bde HQ row). */
  hq: 'auto' | 'bde' | 'div';
  /** The corridors drawn inside each avenue on the map. */
  mapCorridors: boolean;
  /**
   * Labels on the Extended View's map (user, 2026-11-14: "label every line and circle"): `auto` a short label on every
   * line, circle and area (what it is and its key figure), `all` adds the details (widths, times, heights, obstructions),
   * `off` none.
   */
  labels: 'auto' | 'all' | 'off';
  /** Create on Map writes the avenues as the MS attack arrows (Main Attk / Sp Attk, as drawn) or as the IPB Avenue of Apchs symbol. */
  createAs: 'attack' | 'avenue';
  /**
   * Observation and fire corridors (IPB_Plan.md §6.3; Phase 4): how much of each avenue the other side's Posns on the map
   * cover with direct fire and may watch, the gaps, killing area candidates; tab 1, the rail's line 1, the map.
   */
  fire: boolean;
  /** The fire on the avenues on the map: coloured along each avenue (under fire, dead, screened, out of range) and the Posns' ranges. */
  mapFire: boolean;
  /** The proforma for the relative merits of avenues (book p 21) in tab 3: this side's avenues, then the other side's. */
  proforma: boolean;
  /** The proforma's two group headings (the book leaves them blank); empty: En / Own by the side. */
  pfHead1: string;
  pfHead2: string;
  /**
   * Rates, the event template and decision support (IPB_Plan.md §6.6, §6.7; Phase 5): the enemy's time along each avenue at
   * the book's rates, NAIs, TAIs and decision points (2 h before each TAI; the counter-attack while the depth holds); tab 5
   * Decision, the rail's line 5, the map, Create on Map.
   */
  decision: boolean;
  /** NAIs, TAIs and decision points on the map. */
  mapDecision: boolean;
  /** Hours the own action takes on top of the book's 2 h lead for a decision point (p 30), 0 to 12. */
  reactionH: number;
  /** H hour as "HH:MM" (the enemy's start), for clock times and night on the time ladder; empty: times as H+. */
  hHour: string;
  /**
   * Air avenues of approach, LZ / DZ and AD sites (IPB_Plan.md §6.4; Phase 6): least-cost low-level ways over the area
   * read, LZs and DZs ranked, AD sites for long-range, flank and bottom shots; tab 4 Air, the rail's line 4, the map,
   * Create on Map. Off: not worked out.
   */
  air: boolean;
  /** Air avenues, LZ / DZ, AD sites and their ranges on the map. */
  mapAir: boolean;
  /** Flight band of the air avenues (FM 3-04.203, T): NOE to 25 ft, contour 25-80 ft, low level 80-200 ft above the highest obstacle. */
  airBand: 'noe' | 'contour' | 'low';
  /** Landing point size class 1-6 (FM 3-21.38, T: 25 / 35 / 50 / 80 / 100 / 125 m; 4 = Mi-17 class). */
  lzClass: number;
  /** Landing points in one LZ (laid in a square, one diameter apart). */
  lzPoints: number;
  /**
   * Situation template (IPB_Plan.md §6.7; Phase 7): a doctrinal template from `IpbTemplates.json` laid along the avenues
   * and checked on each element's own ground (book pp 22-23). `auto` picks by Read for and the HQ row (a mountain one in
   * mountains); a template id names one; `off`: not worked out. Tab 5 page 2, the map, Create on Map.
   */
  template: string;
  /** The template's elements on the map (where doctrine puts them, where the ground lets them be). */
  mapTemplate: boolean;
}

/** Rates, event template and decision support over the IPB avenues (extended.ipb.decision), Web Mercator. */
export interface IpbDecisionView {
  rates: { mover: 'armour' | 'mech' | 'dismounted'; go: [number, number]; slow: [number, number]; nogo: [number, number] };
  /** Times count from the threat marker's place (true) or from the area's edge (false). */
  fromThreat: boolean;
  hHour: string | null;
  profiles: Array<{ aa: string; viable: boolean; main: boolean; pts: Array<[number, number, number]>; startAlongM: number; startH: [number, number]; endH: [number, number] }>;
  nais: Array<{ id: string; n: number; aa: string; at: MercXY; alongM: number; kind: 'entry' | 'crossing' | 'narrows' | 'slow' | 'crossover'; shows: string; earliestH: number; latestH: number; tai: string | null; widthM: number | null }>;
  tais: Array<{ id: string; n: number; aa: string; at: MercXY; dirDeg: number; alongM: number; why: string; earliestH: number; latestH: number; nai: string }>;
  /** `alongM` from the avenue's frame (below its start: on the way in from the enemy). */
  dps: Array<{ id: string; n: number; kind: 'interdict' | 'catk'; aa: string; tai: string | null; at: MercXY; alongM: number; inArea: boolean; beyondM: number; beforeH: boolean; earliestH: number; decision: string }>;
  catk: { label: string; min: number } | null;
  notes: string[];
}

/** Air avenues, LZ / DZ and AD sites over the IPB area read (extended.ipb.air; GroundGuideIpbAir.ts), Web Mercator. */
export interface IpbAirView {
  /** Whose air avenues: the enemy's into own depth (defence reading) or own to the objective (attack). */
  side: 'enemy' | 'own';
  band: 'noe' | 'contour' | 'low';
  bandLabel: string;
  /** The band's height above the highest obstacle, metres. */
  bandM: [number, number];
  lzClass: number;
  lzPoints: number;
  /** Landing point diameter and the LZ's side, metres. */
  lpM: number;
  lzSideM: number;
  adRangeM: number;
  routes: Array<{
    id: string;
    rank: number;
    line: MercXY[];
    to: string;
    lengthM: number;
    seenPct: number;
    valleyPct: number;
    parallelPct: number;
    buaPct: number;
    follows: Array<{ kind: string; name: string | null; lengthM: number }>;
    wires: number;
    obstructionsNear: Array<{ kind: string; label: string; heightM: number }>;
    why: string;
    profile: Array<{ alongM: number; groundM: number; topM: number; seen: boolean; crest: boolean }>;
  }>;
  lzs: IpbAirZone[];
  dzs: IpbAirZone[];
  ad: Array<{ id: string; rank: number; at: MercXY; seenM: number; longM: number; flankM: number; bottom: number; kinds: Array<'long' | 'flank' | 'bottom'>; routes: string[]; why: string }>;
  /** Vertical obstructions in the area (masts, towers, chimneys, overhead tanks), for the map and the picture. */
  obstructions: Array<{ at: MercXY; kind: string; label: string; heightM: number }>;
  /** The other side's eyes judged (0: concealment not judged). */
  observers: number;
  notes: string[];
  ms: number;
}
/** An LZ or DZ: its square (corners), what it is and why it ranks. */
export interface IpbAirZone {
  id: string;
  kind: 'lz' | 'dz';
  rank: number;
  at: MercXY;
  ring: MercXY[];
  sideM: number;
  lengthM: number;
  points: number;
  slopeDeg: number;
  mountain: boolean;
  caution: string[];
  seenP: number | null;
  distObjM: number | null;
  approaches: number[];
  existing: string | null;
  why: string;
  /** For the enemy's LZ: an OP over it. */
  op: { at: MercXY; distM: number; riseM: number } | null;
}

/** A situation template laid on the area read (extended.ipb.template; GroundGuideIpbTemplate.ts), Web Mercator. */
export interface IpbTemplateView {
  id: string;
  label: string;
  kind: 'attack' | 'defence';
  text: string;
  src: string;
  /** False when any figure of it is a reading of the book's Fig 6 / 7 the user has not confirmed. */
  confirmed: boolean;
  elements: Array<{
    id: string;
    label: string;
    role: string;
    mover: 'armour' | 'mech' | 'dismounted' | 'gun' | null;
    key: string | null;
    ech: string | null;
    footM: number;
    basis: string;
    src: string | null;
    /** Where doctrine puts it; where it ends up. */
    doc: MercXY | null;
    at: MercXY;
    dirDeg: number;
    status: 'fixed' | 'ok' | 'moved' | 'known' | 'outside' | 'nowhere' | 'none';
    movedM: number;
    nogoPct: number;
    why: string;
    box?: MercXY[];
  }>;
  moved: number;
  known: number;
  outside: number;
  phases: { label: string; rows: Array<{ id: string; phase: string; time: string; src: string; basis: string }> };
  library: Array<{ id: string; label: string; kind: 'attack' | 'defence'; fits: string; basis: string; chosen: boolean }>;
  auto: boolean;
  notes: string[];
  ms: number;
}

/** Annex A weather critical values for the month and place (book pp 19-20), coded from the bundle's grids. */
export interface IpbWxView {
  month: number;
  rows: Array<{ mission: string; element: string; go: string; marginal: string; status: 'go' | 'marg' | 'unfav' | 'met' | 'na'; value: string }>;
  stationKm: number | null;
}

/** Fire on the IPB avenues from the other side's Posns (extended.ipb.fire), Web Mercator. */
export interface IpbFireView {
  /** `assumed`: no range in the catalogue (`Rng`), so small arms' 300 m. */
  posns: Array<{ at: MercXY; label: string; effM: number; obsM: number; spot: boolean; assumed?: boolean }>;
  lines: Array<{
    id: string;
    coveredPct: number;
    screenedPct: number;
    deadPct: number;
    outPct: number;
    seenPct: number;
    gaps: Array<{ fromM: number; toM: number; kind: 'd' | 's' | 'o' }>;
    /** Stretches by state along the avenue, for the map and the ribbons: c under fire, s screened, d dead, o out of range. */
    segs: Array<{ state: 'c' | 's' | 'd' | 'o'; fromM: number; toM: number; line: MercXY[] }>;
    startM: number;
    endM: number;
    /** The closest any Posn comes to the avenue, metres, and which (index into `posns`): why it is out of range. */
    nearestM?: number | null;
    nearestPosn?: number;
  }>;
  killing: Array<{ on: string; at: MercXY; alongM: number; kind: 'narrows' | 'stretch'; widthM: number | null; lengthM: number; text: string }>;
  /** Whose Posns: own (defending against the enemy's avenues) or the enemy's. */
  posnSide: 'own' | 'enemy';
  ms: number;
}

/** The proforma (extended.ipb.proforma): the engine's result, for the tab 3 table and Copy as Text. */
export interface IpbProformaView {
  groups: Array<{ head: string; side: 'enemy' | 'own'; ids: string[] }>;
  rows: Array<{ key: string; short: string; label: string; basis: string; why: string; cells: Array<Array<{ id: string; sign: '+' | '−' | '?'; suggested: '+' | '−' | '?'; user: boolean; value: string }>> }>;
  totals: number[][];
  lead: Array<{ id: string; total: number } | null>;
  note: string;
  /** The second group is still being worked out. */
  pending: boolean;
}

/** One avenue of approach (or lone corridor) of an IPB reading, Web Mercator. */
export interface IpbApchAa {
  id: string;
  rank: number;
  /** False: a lone corridor, not an avenue. */
  viable: boolean;
  /** Drawn as the main attack (the best going of the viable avenues): the inner line in its head. */
  main: boolean;
  open: boolean;
  /** Centre line (simplified), and the arrow drawn round it: fill ring, stroke (back left open), inner line. */
  line: MercXY[];
  arrow: { fill: MercXY[]; stroke: MercXY[]; inner: MercXY[] };
  /** Free width across along it (every ~250 m), metres, and the distance from the area's start edge. */
  widthM: number[];
  alongM: number[];
  lengthM: number;
  startM: number;
  endM: number;
  stopped: boolean;
  coverPct: number;
  twoPct: number;
  onePct: number;
  goPct: number;
  medianWidthM: number;
  minWidthM: number;
  narrows: Array<{ at: MercXY; alongM: number; widthM: number; kind: 'crossing' | 'slow' | 'narrow' }>;
  waterLines: number;
  why: string[];
  /** Mean place across the area, metres (negative: left as the mover sees). */
  sideM: number;
  mcs: string[];
}

/** The IPB mobility corridors and avenues of approach over the area read (Extended View, `extended.ipb.apchs`). */
export interface IpbApchView {
  key: string;
  /** Whose avenues: the enemy's toward the position (defence) or own toward the threat (attack). */
  side: 'enemy' | 'own';
  /** The HQ row used, what the avenues and corridors are for, and why (a Bn HQ has no row in the book). */
  hq: 'bde' | 'div';
  hqLabel: string;
  hqNote: string | null;
  /** The echelon of the symbol read (Pl, Coy, Bn...), shown beside the HQ row it reads with; null without one. */
  forEch?: string | null;
  aaFor: string;
  mcFor: string;
  mcWidthM: number;
  spacingM: number;
  mover: 'armour' | 'mech' | 'dismounted';
  /** The direction of movement (grid bearing) and the area read: its corners (start-left, start-right, end-right, end-left). */
  axisDeg: number;
  frame: MercXY[];
  frameKm: [number, number];
  anchor: MercXY;
  /** The threat is only a direction: the avenues start at the area's edge on its bearing. */
  threatAssumed: boolean;
  aas: IpbApchAa[];
  mcs: Array<{ id: string; aa: string | null; line: MercXY[] }>;
  crossovers: Array<{ id: string; a: string; b: string; from: MercXY; to: MercXY; alongM: number; depthM: number }>;
  notes: string[];
  ways: string[];
  codingText: string;
  /** The area's coding as a small picture for the Detail (a PNG data URL) and its extent [xmin, ymin, xmax, ymax]. */
  raster?: { url: string; extent: [number, number, number, number] } | null;
  /** Fire on the avenues (extended.ipb.fire): undefined while off or not worked out yet. */
  fire?: IpbFireView | null;
  /** The proforma (extended.ipb.proforma): undefined while off or not worked out yet. */
  proforma?: IpbProformaView | null;
  /** Rates, event template and decision support (extended.ipb.decision): undefined while off or not worked out yet. */
  decision?: IpbDecisionView | null;
  /** Annex A weather for the month and place (with the fire or the decision on). */
  wx?: IpbWxView | null;
  /** Air avenues, LZ / DZ, AD sites (extended.ipb.air): undefined while off or not worked out yet. */
  air?: IpbAirView | null;
  /** The situation template (extended.ipb.template): undefined while off or not worked out yet. */
  template?: IpbTemplateView | null;
  ms: { coding: number; corridors: number };
}

export interface GroundGuideExtendedOptions {
  /** F turns the Extended View on and off; with it on, 1 2 3 open its tabs, [ and ] turn the threat, J takes the better Posn. */
  keys: boolean;
  /**
   * How long F keeps it on (user, 2026-11-12: "intuitive, save the computer, less annoying"). `symbol` (default): while
   * the same kind of symbol is placed (stamping several Pls); arming a different kind or cancelling the draw (Esc) closes
   * it. `once`: for one placement. `kept`: until F. Shift+F keeps it on whatever this says. It always goes off with the
   * guide, and it rests (reads nothing) while a line or area is drawn.
   */
  lasts: 'symbol' | 'once' | 'kept';
  threat: OcokaThreatMode;
  /** Threat bearing for `threat: 'bearing'`, degrees clockwise from north. */
  bearingDeg: number;
  /** Width of the arc judged toward the threat, degrees (30 to 180). */
  sectorDeg: number;
  /** The threat point for `threat: 'point'`, [longitude, latitude]; null falls back to the front. */
  at: [number, number] | null;
  /** Show the threat marker on the map while the Extended View is on: drag it to set the threat point, double-click it for the front. */
  marker: boolean;
  /** Radius of the observation reading, km (1 to 10). */
  radiusKm: number;
  /**
   * What is drawn on the map while placing with the Extended View on (2026-11-11): the fire fan toward the threat with
   * dead (red) and screened (amber) ground; the threat's own view when it is a place (violet) and whether it sees the
   * position; lines of sight to the ITG candidates; the approaches from the threat with their chokepoints; a better
   * position nearby for the same weapon, which J takes.
   */
  mapFan: boolean;
  mapEnemy: boolean;
  mapSight: boolean;
  mapApproaches: boolean;
  mapBetter: boolean;
  /**
   * What the map overlay (`overlay.enabled`) paints while the Extended View is on (2026-11-11). `threat`: all the
   * ground the threat may see from its place, out to `radiusKm` (violet; needs the threat as a place). `view`: all the
   * ground that may be seen from the position being placed (light blue), once the cursor rests. `going`: the GROTBC
   * paint, as with the Extended View off. `auto`: `threat` when the threat is a place, else `view`. `ipb` (2026-11-14):
   * the IPB combined obstacle overlay, coded by the IPB book's criteria (`ipb`), round the symbol being placed or the map
   * centre (GroundGuideIpb.ts).
   */
  overlay: 'auto' | 'view' | 'threat' | 'going' | 'ipb';
  /** The IPB coding (IPB_Plan.md §6.1): worked out only while the Extended View is on and the overlay paints `ipb`. */
  ipb: GroundGuideIpbOptions;
  /** Eye height: `auto` takes a vehicle commander's for tracked vehicles and a standing man's otherwise. */
  eye: OcokaEye;
  /** Count what stands on the ground (buildings, crops, trees, bunds, walls); off judges on the ground alone. */
  surface: boolean;
}

/**
 * The Gr Scope rail (user, 2026-11-08): a side window docked at the edge of the map, shown and hidden with V at any time
 * the guide is on, not tied to the mouse. Its map gives the ground round the symbol being placed (else the selected
 * symbol, the one just placed, the map centre) with range rings, the frontage for the echelon, clear ground and the
 * GROTBC things nearby; its legend is one line per letter, each also that layer's switch.
 */
export interface GroundGuideScopeOptions {
  /** V shows and hides the rail; off: no rail and no V key. */
  enabled: boolean;
  /** Which edge of the map it docks to. */
  side: 'right' | 'left';
  /** A small "V · Gr Scope" tab at that edge while the rail is hidden (click to show it). */
  tab: boolean;
  /** Room kept free above the rail at the top of the map for the host's toolbar, px (inside any `view.padding`). */
  topPx: number;
}

export interface GroundGuideGoingOptions {
  /** Ground state judged: dry season, after heavy rain, or `auto` (after rain when the month's rain at the point reaches `wetMonthMm`). */
  season: 'auto' | 'dry' | 'wet';
  /** Month for `auto` and the season ribbon, 1-12; 0 = the current month. */
  month: number;
  /** Monthly rain (mm, climate normal) from which a month counts as wet. */
  wetMonthMm: number;
  /** How far the movement sections look round the point, km. */
  rangeKm: number;
  /** Which symbols get the movement sections: land units and equipment, every point symbol, or every symbol. */
  movementFor: 'units' | 'points' | 'all';
}

/** Card sections for going, soil and movement. Letters match ground-guide-card-movement.html. */
export interface GroundGuideCardOptions {
  /**
   * The cursor card. `minimal`: the verdict header, Why (with the GO / SLOW-GO / NO-GO scale), Inside, Nearest and
   * the Inter Gap Rule; everything else waits in the Ground Detail (D). `full`: every section switched on below as well.
   */
  cursor: 'minimal' | 'full';
  /**
   * The minimal card's Nearest. `ranked` (2026-11-07): up to three different things round the point, most important
   * first (the ground that decides the verdict, an obstacle for the mode, better cover when there is little here,
   * the road for the mode, the nearest place, an ITG candidate), each with its distance and direction and all on one
   * compass. `deciding`: only the ground that decides the verdict, as before.
   */
  nearest: 'ranked' | 'deciding';
  /**
   * Start each session with the cursor card shrunk to the hint chip (the verdict colour, GO / SLOW-GO / NO-GO and the
   * one figure that changes the decision), so the map under the symbol shows. H switches between the chip and the
   * card while drawing (2026-11-07).
   */
  hint: boolean;
  /** A: cross-country going dry and after rain, the soil and what limits the going. */
  goingLines: boolean;
  /** B: movement rose, eight directions to `going.rangeKm`, with a freedom rating and what blocks it. */
  movementRose: boolean;
  /** C: soil strength gauge, cone index dry and after rain against the mode's thresholds. */
  soilStrength: boolean;
  /** E: exit strip, the eight directions as one compact row. */
  exitStrip: boolean;
  /** F: mode matrix, foot / wheeled / tracked, dry and after rain. */
  modeMatrix: boolean;
  /** G: season ribbon, twelve months of rain coloured by the going they leave. */
  seasonRibbon: boolean;
  /** H: going map, a small picture of the going all round the point. */
  goingMap: boolean;
  /** D: the D key opens the Ground Detail (a tab a letter: G R O T B C, and K the Legend); a letter opens it on that tab. */
  briefKey: boolean;
  /**
   * The key notice (user, 2026-11-14): when a key changes a mode (F, Shift+F, X, [ ], J, V, Shift+V, H, P), a card at
   * the foot of the screen says the mode now and the keys that work in it, for 5 s. Off: the card's flash and the chip.
   */
  keyNotice: boolean;
}

export type GoingStep = 'go' | 'slow' | 'nogo';
export type GoingSeason = 'dry' | 'wet';

/** The soil under the point (soil + rci layers). */
export interface GroundGuideSoil {
  /** Texture code (rules.json grotbc.layers.soil): 1 Sand ... 12 Clay, 13 Rocky / stony, 14 Salt pan. */
  texture: number;
  label: string;
  /** 0 better than typical, 1 typical, 2 poorer than typical, 3 filled from nearby soil. */
  confidence: number;
  confidenceLabel: string;
  /** From the 1:50k map (NCGDB soil areas) rather than the 250 m model. */
  mapped: boolean;
  /** The bundle's words for this soil ("Hard when dry, soft after rain"). */
  note: string | null;
  /** Cone index dry / after rain (127 = 127 or more); null where the layer has no value. */
  ciDry: number | null;
  ciWet: number | null;
  /** Sand: the vehicles' `coarse` thresholds apply. */
  coarse: boolean;
}

export interface GroundGuideMovementSector {
  bearingDeg: number;
  compass: string;
  step: GoingStep;
  /** Ground distance before the first NO-GO, up to the range. */
  reachM: number;
  /** What stopped the ray, when something did. */
  blockedBy: string | null;
}

export interface GroundGuideMovement {
  rangeM: number;
  sectors: GroundGuideMovementSector[];
  /** Directions open to at least half the range. */
  open: number;
  /** 0-1: going weight x reach, averaged over the eight directions. */
  score: number;
  rating: 'unrestricted' | 'restricted' | 'severe';
}

/** Going, soil and movement round the point, for the card and the Ground Brief. */
export interface GroundGuideGoingInfo {
  season: GoingSeason;
  /** Month the season came from (1-12) with `season: auto`; null when it was set by hand. */
  month: number | null;
  /** The mode's vehicle thresholds on this soil (fine or sand); null when the mode is not judged on soil. */
  vehicle: { label: string; vci: [number, number] } | null;
  soil: GroundGuideSoil | null;
  /** Going at the point for the mode, both seasons, and what limits it. */
  point: { dry: GoingStep; wet: GoingStep; limitDry: string | null; limitWet: string | null } | null;
  /** Foot / wheeled / tracked (and the active mode when it is another), both seasons. */
  modes: Array<{ profile: string; label: string; dry: GoingStep; wet: GoingStep; active: boolean }>;
  movement: GroundGuideMovement | null;
  /** Monthly rain at the point (mm, 12 values) and the wet threshold, when the bundle has climate. */
  climate: { precMm: number[]; wetMm: number } | null;
  /** Going on a `size` x `size` grid over the range square: 0 GO, 1 SLOW-GO, 2 NO-GO, 255 outside / no data. Row 0 = north. */
  map: { size: number; cells: Uint8Array; rangeM: number } | null;
  /** Some tiles were still on their way: the figures may change. */
  pending: boolean;
}

export interface GroundGuideItgOptions {
  /** List the candidates on the card while drawing. */
  enabled: boolean;
  /** How far round the cursor to look, km (ground). */
  radiusKm: number;
  /** How many the card lists (the API is not capped by this). */
  max: number;
  /** 1 = every candidate, 2 = strong candidates (check as MITG) only. */
  minLevel: 1 | 2;
}

/**
 * An Important Tactical Ground candidate from the terrain bundle: a terrain feature (peak, saddle, junction,
 * bridge ...) that passed one or more of the objective tests in rules.json `grotbc.itg.reasons`. A candidate,
 * not a designation: ITG / MITG depend on the task and are the user's decision.
 */
export interface GroundGuideItgCandidate {
  /** Feature kind key (`peak`, `hill`, `saddle`, `main_junction`, `bridge`, ...) and its label. */
  kind: string;
  kindLabel: string;
  name: string | null;
  /** 1 ITG candidate, 2 strong candidate (check as MITG). */
  level: 1 | 2;
  /** Reason letters (H, O, R, P, C, J) and the rule owner's label for each. */
  reasons: string[];
  reasonLabels: string[];
  elevationM: number | null;
  at: MercXY;
  /** [longitude, latitude]. */
  lngLat: [number, number];
  /** From the point asked about. */
  distanceM: number;
  bearingDeg: number;
  compass: string;
  /** Every attribute the bundle carries for it (`rr`, `iso`, `vs`, `mv`, `hs`, ...; see features/index.json). */
  attributes: Record<string, unknown>;
  /** What the bundle measured on it (ground.py), decoded for the card. */
  traits: GroundGuideItgTraits;
}

/**
 * The characteristics of an ITG candidate, as the pipeline measured them from the DEM (ground.py). Null where the
 * bundle carries nothing; NCGDB features flagged as candidates (bridges, passes, dams) carry few or none of them.
 */
export interface GroundGuideItgTraits {
  /** `rr`: height above the lowest ground within 2 km, m. */
  reliefM: number | null;
  /** `iso`: the highest ground within this radius, km (0.5 = not the highest within 1 km; 5 = 5 km or more). */
  dominanceKm: number | null;
  /** `vs`: share of the ground within 5 km seen from 2 m above it, %. */
  viewPct: number | null;
  /** `mv`: the nearest MSR in view, km. Null when none is in view (only meaningful when `viewTested`). */
  msrInViewKm: number | null;
  /** The view test ran on it (`vs` is set): a missing `mv` then means no MSR in view within 5 km. */
  viewTested: boolean;
  /** `sp`: mean slope within 300 m, degrees. */
  slopeDeg: number | null;
  /** `dr` / `dn`: nearest MSR / road or track, km (up to 5). */
  msrKm: number | null;
  roadKm: number | null;
  /** The distances were measured (a DEM feature): a missing `dr` / `dn` then means none within 5 km. */
  distancesTested: boolean;
  /** `lc`: the ground class at the feature (label). */
  ground: string | null;
  /** `cv`: the cc layer at the feature (cover = v & 15, concealment = v >> 4; 0 None, 1 Poor, 2 Fair, 3 Good). */
  cover: 0 | 1 | 2 | 3 | null;
  concealment: 0 | 1 | 2 | 3 | null;
  /** `hs`: surveyed height of a trig station or spot height within 250 m, m. */
  surveyedM: number | null;
}

/** ITG candidates round the cursor, for the card. */
export interface GroundGuideItg {
  candidates: GroundGuideItgCandidate[];
  radiusM: number;
  /** A feature tile is still loading, so the list may grow. */
  pending: boolean;
}

/**
 * How the card shows the people round the cursor. Every style is kept so the owner can compare them live
 * (ground-guide-population-options.html shows them side by side); `off` shows nothing.
 *  - line: one People line with the density class, then the nearest place
 *  - scale: the class, the count and a six-step density scale (like the GO / SLOW-GO / NO-GO scale)
 *  - rings: a small target with rings at 1, 3 and 5 km shaded by density and places at their bearing
 *  - ages: a big number, males 15-49 and an age bar (under 15 / 15-64 / 65+)
 *  - rose: eight petals, one per compass sector, sized by the people in it: where the people are
 *  - minimap: the 1 km cells round the cursor as a small heat map
 *  - profile: density by distance band (0-1 ... 7-10 km): how fast it fills up going out
 *  - icons: ten person icons, as many lit as the density (log scale), with the count
 *  - compare: this area against the province's average and its typical resident (population weighted density)
 *  - block: the full civil considerations block (rings, ages, places, comparison, sources)
 */
export type GroundGuidePopulationCardStyle =
  | 'off'
  | 'line'
  | 'scale'
  | 'rings'
  | 'ages'
  | 'rose'
  | 'minimap'
  | 'profile'
  | 'icons'
  | 'compare'
  | 'block';

export interface GroundGuidePopulationOptions {
  /** Read the population grid at all (card, flag, layer and the API). */
  enabled: boolean;
  /** Card style (`off` = no population row on the card). */
  card: GroundGuidePopulationCardStyle;
  /** Civil flag: a header pill and a strip when the unit type's threshold is met (advisory; never changes the verdict). */
  flag: boolean;
  /** Radius the density class and the main count are measured over, km. */
  radiusKm: number;
  /** Paint the People layer (1 km cells coloured by density class) on the map. */
  layer: boolean;
  /** Opacity of the People layer. */
  layerOpacity: number;
}

/** One density class, people per km² from `min` up to the next class. */
export interface GroundGuidePopulationClass {
  key: 'empty' | 'sparse' | 'rural' | 'denseRural' | 'town' | 'urban';
  label: string;
  /** Lower bound, people per km². */
  min: number;
  color: string;
  /** Dark swatch: write on it in white. */
  dark: boolean;
}

/** A named place round the point (bundle features: city, district HQ, town, important village, village). */
export interface GroundGuidePopulationPlace {
  name: string;
  kind: string;
  kindLabel: string;
  /** WorldPop people nearest this place (`wp`), else the official figure (`p`); null when neither is recorded. */
  people: number | null;
  province: string | null;
  district: string | null;
  tehsil: string | null;
  distanceM: number;
  bearingDeg: number;
  compass: string;
  lngLat: [number, number];
}

/** People round a point, from the bundle's population grid (WorldPop estimates, not a census). */
export interface GroundGuidePopulationReading {
  lngLat: [number, number];
  /** `population.radiusKm`: the count, class and age split are for this radius. */
  radiusKm: number;
  /** People within 1, 2, 3, 5 and 10 km. */
  rings: Array<{ km: number; people: number }>;
  people: number;
  perKm2: number;
  cls: GroundGuidePopulationClass;
  /** Within `radiusKm`; null when the grid has no age layers. */
  ages: { males15_49: number; under15: number; over65: number } | null;
  /** People per km² in distance bands out from the point. */
  bands: Array<{ fromKm: number; toKm: number; perKm2: number }>;
  /** People within `radiusKm` in eight compass sectors, N first, clockwise. */
  sectors: number[];
  /** Cells round the point, north row first: people per km² (-1 = no data); `size` × `size`, centre = the point. */
  grid: { size: number; cellKm: number; perKm2: number[] };
  /** People per km² at the point by the 2020 unconstrained density (people living among the fields); null when absent. */
  density2020: number | null;
  /** Named places within 10 km, nearest first. */
  places: GroundGuidePopulationPlace[];
  /** Province of the nearest place, with its average density and the density its typical resident lives at (2020). */
  province: { name: string; perKm2: number; typicalPerKm2: number } | null;
  /** Feature tiles for the places are still loading. */
  pending: boolean;
  /** "WorldPop 2026 Estimate" and the source dates from the bundle. */
  source: { label: string; dataDate: string | null; released: string | null };
}

/** The population row of a live verdict: the reading, the card style and the civil flag when it applies. */
export interface GroundGuidePopulation {
  reading: GroundGuidePopulationReading;
  style: GroundGuidePopulationCardStyle;
  /** Set when the unit type's threshold is met (and `flag` is on): people within `km`, and why it matters. */
  flag: { km: number; people: number; message: string } | null;
}

/** One terrain reading. `null` = no tile loaded / no coverage. */
export interface TerrainSample {
  classCode: number | null;
  distanceM: number | null;
}

/** A point in Web Mercator metres (EPSG:3857 / wkid 102100). */
export type MercXY = [number, number];

/**
 * A line from the symbol (or the part of a shape that decides the verdict) to the
 * terrain that is the reason for it — for a host that wants to draw its own cue.
 * The guide draws these itself when `indicators.enabled` is on.
 */
export interface GroundGuideIndicator {
  /**
   * `no-go`: to the nearest no-go ground (a symbol that is too close).
   * `deployable`: to the nearest deployable ground (a symbol that is inside no-go).
   * `contested`: to the centre of the part of a line/area that lies in no-go.
   */
  kind: 'no-go' | 'deployable' | 'contested';
  from: MercXY;
  to: MercXY;
  /** Extra markers on the parts of a line/area that lie in no-go (decimated). */
  marks: MercXY[];
  classCode: number | null;
  className: string | null;
  /** Short text for the end of the line, e.g. "Permanent water 120 m to the W". */
  label: string;
  /**
   * `contested` only: the stretches of the line / area edge (or footprint outline) that lie in no-go ground,
   * as Web Mercator point runs, for the map to colour where the shape needs fixing.
   */
  stretches?: MercXY[][];
}

/** The closest terrain of the opposite kind: no-go ground near a deployable point, or deployable ground near a no-go point. */
export interface GroundGuideNearest {
  kind: 'no-go' | 'deployable';
  classCode: number;
  className: string;
  distanceM: number;
  /** Where the search started (the deciding sample) and the nearest edge it found, Web Mercator metres. */
  from: MercXY;
  to: MercXY;
  /** Compass bearing from the sample to it, degrees clockwise from north. */
  bearingDeg: number;
  /** 8-point compass label, e.g. "NE". */
  compass: string;
}

/** The ground an echelon symbol was judged on, instead of its click point. */
export interface GroundGuideFootprintInfo {
  /** 2-digit 2525D echelon code and its name ("14", "Platoon"). */
  code: string;
  echelon: string;
  /** Width across the front and depth to the rear, ground metres; depth 0 = a line. */
  frontageM: number;
  depthM: number;
  /** Minimum gap to the next same-echelon unit along the front, metres. */
  gapM: number;
  /** Facing of the footprint that decided the verdict, degrees from north; null for the disc. */
  facingDeg: number | null;
  facing: GroundGuideFacingMode;
  /** The footprint outline in Web Mercator metres: a ring (rectangle / disc) or a 2-point line. */
  ring: MercXY[];
  /**
   * The frontage in equal blocks, left to right as the unit faces (W to E when facing N; W to E across the disc),
   * from the samples the verdict took: the cursor card's frontage strip. Absent when no sample was known.
   */
  front?: GroundGuideFrontBlock[];
  /** 8-point compass of the strip's left and right ends ("W", "E"). */
  frontEnds?: [string, string];
}

/** One block of the frontage strip (`GroundGuideFootprintInfo.front`). */
export interface GroundGuideFrontBlock {
  /** Share of the block's known samples in NO-GO, 0–1. */
  nogo: number;
  /** The rest of the block: `slow` when any of it is SLOW-GO, else `go`; null when the block has no terrain data. */
  rest: 'go' | 'slow' | null;
}

/** Result of the intergap check against same-echelon symbols already on the map. */
export interface GroundGuideSpacing {
  /** `overlap`: footprints touch or overlap. `tight`: gap is below the echelon's minimum. */
  status: 'ok' | 'tight' | 'overlap';
  /** Required minimum gap, metres. */
  minGapM: number;
  /** Smallest gap to a neighbour within reach, metres; null when none is. */
  nearestGapM: number | null;
  /** Neighbours that are too close, nearest first (capped), with their footprint outlines. */
  conflicts: Array<{ at: MercXY; gapM: number; ring: MercXY[] }>;
  /** One sentence for the badge; null when the spacing is fine. */
  message: string | null;
}

export interface GroundGuideVerdict {
  verdict: GroundGuideVerdictKind;
  profile: GroundGuideProfile;
  /** Human label of the profile ("Wheeled vehicles"). */
  profileLabel: string;
  /** Second line: why it is not deployable / what is nearby. */
  detail: string | null;
  nearest: GroundGuideNearest | null;
  /** Lines to the terrain behind the verdict (empty for ok / caution / unknown). */
  indicators: GroundGuideIndicator[];
  /** Dominant class of the in-no-go samples (or of the single point sample). */
  classCode: number | null;
  className: string | null;
  /** Smallest distance to no-go among deployable samples, metres. */
  distanceM: number | null;
  /** Share of known samples inside no-go, 0–1. */
  fraction: number;
  samples: number;
  unknown: number;
  message: string;
  /** Set when the search for the nearest terrain of the other kind found none within this many metres. */
  noneWithinM?: number;
  /** Set while tiles the shape needs are still arriving, so the verdict is provisional. */
  loading?: boolean;
  /** Set when an echelon symbol was judged on its footprint rather than its point. */
  footprint?: GroundGuideFootprintInfo | null;
  /** Set alongside `footprint` when the intergap check ran. Advisory: never changes `verdict`. */
  spacing?: GroundGuideSpacing | null;
  /** Set while drawing a point the snap key can move to usable ground (the verdict is bad and the quick fix is on). */
  snappable?: boolean;
  /**
   * Set while drawing a point symbol with some of it in NO-GO: the nearest clear ground, where all of it (its footprint)
   * is out of NO-GO. The hint chip points to it. It is the S Quick Fix's own search, so S moves the symbol there.
   */
  clear?: GroundGuideClearGround | null;
  /** Set while drawing when `enforce` mode would refuse this verdict at the click. */
  blocked?: boolean;
  /** Set alongside `blocked` when holding Shift at the click places it anyway. */
  overridable?: boolean;
  /** Set while drawing: the judged profile was chosen by hand rather than derived from the SIDC. */
  profileOverride?: boolean;
  /**
   * Set while drawing when the map overlay is on and paints another mode (fixed in the settings) than the one judged
   * here: that mode's label. The cards say so, or the colours under the cursor would read as this unit's going.
   */
  overlayOther?: string | null;
  /** Set while drawing when the P key can change the judged profile. */
  profileKey?: boolean;
  /** The rule behind the verdict, in the rule owner's words (rules.json `why` / class `note`); null when the bundle has none. */
  reason?: string | null;
  /** Set on an `unknown` verdict when a tile it needs is still on its way (as opposed to no coverage). */
  waiting?: boolean;
  /** Set while drawing when `itg.enabled` and the bundle has ground features: ITG candidates round the cursor. */
  ground?: GroundGuideItg | null;
  /** Set while drawing when a going section or the Ground Brief needs it and the bundle has the soil layers. */
  going?: GroundGuideGoingInfo | null;
  /** Set while drawing when the D key opens the Ground Detail. */
  briefKey?: boolean;
  /** Set while drawing when `population.enabled` and the bundle has a population grid: the people round the cursor. */
  population?: GroundGuidePopulation | null;
  /** Set while drawing when a T option shows something on the card (road line, rain pill, second scale). */
  traffic?: GroundGuideTraffic | null;
  /** Set while drawing when `cover.enabled` and the bundle has the cover rules: C at and round the point. */
  cover?: GroundGuideCover | null;
  /** Set while drawing when a G / R / B / W section is on: the layers and features the card did not show before. */
  sections?: GroundGuideSections | null;
  /** Set while drawing when `speed.enabled` and the symbol moves on the ground: how fast it goes here and on the road. */
  speed?: GroundGuideSpeed | null;
  /** Set while drawing: the Extended View is on (true) or off (false); null when its keys are off or there is no keyboard. */
  extended?: boolean | null;
  /** The Extended View stays on for every symbol (Shift+F, or `extended.lasts: kept`) rather than closing on a new one. */
  extKept?: boolean;
  /** Why the Extended View reads nothing for this draw although it is on (a line or an area); null when it reads. */
  extRest?: string | null;
  /** Set while drawing with the Extended View on and the bundle's elevation loaded: its reading at the point. */
  ext?: GroundGuideOcoka | null;
}

/** An ITG candidate as the Extended View reads it: where it is and whether it and the point are in view of each other. */
export interface OcokaKeyGround {
  name: string | null;
  kindLabel: string;
  level: 1 | 2;
  distanceM: number;
  bearingDeg: number;
  compass: string;
  /** Its height above the point, metres (null when the bundle has no height for it). */
  higherM: number | null;
  /** The chance that a man on it and the point see each other, 0 to 1 (null: outside the ground read, or not loaded). */
  seenP: number | null;
  at: MercXY;
  /** The candidate as the bundle gives it (reasons, traits, elevation, longitude / latitude for `designateGround`). */
  itg: GroundGuideItgCandidate;
}

/** The quick map products of the Extended View, in Web Mercator: rings are closed and clockwise. */
export interface OcokaMapSight {
  /** The fire fan toward the threat out to the weapon's range: its outline, and the dead and screened ground inside it. */
  fan: { outline: MercXY[]; dead: MercXY[][]; screened: MercXY[][]; rangeM: number };
  /** Lines of sight from the position: the chance the far end is seen, and where the line is lost when it probably is not. */
  lines: Array<{ kind: 'itg'; /** The candidate's rank (ITG n in tab 2). */ n?: number; to: MercXY; p: number; blockAt: MercXY | null }>;
  /** The threat as a place: the chance it sees the position, where its line is lost, and the ground between that it sees. */
  enemy: { at: MercXY; seesP: number; distM: number; blockAt: MercXY | null; blockAtM: number | null; coveredPct: number; outline: MercXY[]; seen: MercXY[][] } | null;
}

export interface OcokaAvenue {
  /** From the threat's end to the position. */
  path: MercXY[];
  lengthM: number;
  /** Share of it on GO ground, %. */
  goPct: number;
  /** The narrowest passable ground along it, metres, and whether the formation's frontage fits everywhere. */
  minWidthM: number;
  fits: boolean;
  chokes: Array<{ at: MercXY; widthM: number; label: string; fromPosnM: number }>;
}

/** The Extended View's map overlay: the ground that may be seen all round from one spot (the threat's place, or the position). */
export interface OcokaMapOverlay {
  kind: 'threat' | 'view';
  at: MercXY;
  radiusM: number;
  outline: MercXY[];
  /** The ground seen with an even chance or better, as rings (Web Mercator, closed, clockwise). */
  seen: MercXY[][];
  /** Share of the ground inside the radius that may be seen, %. */
  seenPct: number;
}

/** The slower map products: approaches for a formation of `frontageM` (`avenues`), and a better position nearby. */
export interface OcokaMapPlan {
  frontageM: number;
  /** Where the avenues start: the threat's place, or (`fromAssumed`) a start out on its bearing when it is only a direction. */
  from: MercXY | null;
  fromAssumed: boolean;
  avenues: OcokaAvenue[];
  /** No way in for the mode: what stops it. */
  noAvenue: string | null;
  better: { at: MercXY; distanceM: number; bearingDeg: number; compass: string; grade: 'good' | 'marginal' | 'poor'; hereGrade: 'good' | 'marginal' | 'poor'; seenPct: number; hereSeenPct: number; clearM: number; higherM: number } | null;
}

/** The viewshed behind the Detail's picture: per ray and step the chance of being seen (0-250, 255 no data). */
export interface OcokaPicture {
  rays: number;
  steps: number;
  bearings: Float32Array;
  p: Uint8Array;
  pTerrain: Uint8Array;
  radiusM: number;
  stepM: number;
}

/**
 * The Extended View's reading at a point (the OCOKA engine, GroundGuideOcoka.ts, does the sums; MS/Data/OcokaDoctrine.json
 * holds the figures).
 * Everything about sight is a chance, not a fact: the cards say "may be seen" and "check on the ground".
 */
export interface GroundGuideOcoka {
  /** A tile it needs is still loading: the figures may change. */
  pending: boolean;
  at: MercXY;
  lngLat: [number, number];
  elevationM: number;
  threat: { mode: OcokaThreatMode; bearingDeg: number; sectorDeg: number; compass: string; allRound: boolean };
  /** The weapon fields of fire are judged for: the symbol's own `Rng`, or small arms when it has none. */
  weapon: OcokaWeapon & { label: string };
  eyeM: number;
  eyeLabel: string;
  month: number;
  radiusM: number;
  /** What stands on the ground was counted (`extended.surface`). */
  surface: boolean;
  obs: OcokaObservation;
  /** Null for a weapon that needs no line of sight of its own (mortars, guns, air defence). */
  fire: OcokaFire | null;
  obstacle: OcokaObstacleFront & { nogoLabel: string | null; cautionLabel: string | null; rangeM: number };
  ways: {
    radiusM: number;
    total: number;
    go: number;
    slow: number;
    blocked: number;
    /** North first, clockwise. */
    state: WayState[];
    distM: number[];
    /** What stops the stopped ways: the ground, how many of the directions, and the arc they cover ("W-NW"). */
    stops: Array<{ label: string; sectors: number; arc: string }>;
  };
  key: {
    /** The point against the highest ground within `withinM`: metres above it (negative: below), and where that ground is. */
    aboveMaxM: number;
    maxM: number;
    distM: number;
    compass: string;
    withinM: number;
    highest: boolean;
    candidates: OcokaKeyGround[];
    candidatesPending: boolean;
  };
  /** Share of cropland whose crop hides a standing / crouching man this month, % (OcokaDoctrine.json cropCalendar). */
  crop: { tallPct: number; hidesPct: number };
  /** The month's visibility (NOAA GSOD grid in the bundle); null when the bundle has none or it has not loaded. */
  weather: VisibilityReading | null;
  /** The light the reading is for (`speed.light`), and for night whether the coming night is moonlit. */
  light: { night: boolean; level: 'day' | 'moonlight' | 'starlight'; moonlitShare: number | null; moonIllum: number | null };
  /** The weapon's night sight on an ordinary day of the month, a haze day and a fog day; null when it has none. */
  nightSight: { deviceM: number; ordinaryM: number; hazeDayM: number; fogDayM: number; thermal: boolean } | null;
  /** Set while the Ground Detail is open: the viewshed for its picture. */
  picture: OcokaPicture | null;
  /** Set once the map products for this spot are worked out (a moment after the cursor rests). */
  sight?: OcokaMapSight | null;
  plan?: OcokaMapPlan | null;
  /** The IPB avenues over the area read: undefined when `extended.ipb.apchs` is off, null while being worked out. */
  ipbApch?: IpbApchView | null;
}

/** One symbol judged by `auditPlacements()` / `explain()`. */
export interface GroundGuideAuditEntry {
  graphic: any;
  id: string | null;
  name: string;
  sidc: string | null;
  profile: GroundGuideProfile;
  profileLabel: string;
  verdict: GroundGuideVerdictKind;
  message: string;
  detail: string | null;
  /** The rule behind the verdict in the rule owner's words, when the bundle gives one. */
  rule: string | null;
  /** `profile` was set by hand when the symbol was placed, so the audit keeps judging it that way. */
  profileOverride: boolean;
  fraction: number;
  /** Intergap message when the inter gap rule is not met. */
  spacing: string | null;
  /** What the stamp said before this check (null = never stamped, e.g. loaded from a plan). */
  previous: GroundGuideVerdictKind | null;
  /** True when the verdict is different from the stamp it carried. */
  changed: boolean;
  /** Placed against the rules with Shift-click, and why when a reason was recorded. */
  overridden: boolean;
  reason: string | null;
  /** In / partial / touching no-go: needs a look. */
  problem: boolean;
  /** Orders problems worst first. */
  severity: number;
}

export interface GroundGuideAudit {
  /** Symbols judged. */
  checked: number;
  /** Symbols that are not terrain-bound (air, sea, …) or have no usable geometry. */
  exempt: number;
  /** Symbols outside the terrain bundle's coverage. */
  outside: number;
  /** Symbols whose tiles never arrived, so they are not judged. */
  unchecked: number;
  counts: Partial<Record<GroundGuideVerdictKind, number>>;
  entries: GroundGuideAuditEntry[];
  /** `entries` that are problems, worst first. */
  problems: GroundGuideAuditEntry[];
}

/** Whether the guide has terrain data, for hosts that want to show it (also on `ground-guide-state-change`). */
export interface GroundGuideStatus {
  state: 'disabled' | 'no-bundle-url' | 'loading' | 'ready' | 'failed';
  /** Why the bundle failed to load (`failed` only). */
  error: string | null;
  /** Milliseconds until the next automatic retry, or null when none is scheduled. */
  retryInMs: number | null;
}

/**
 * The nearest clear ground for a point symbol that is partly or wholly in NO-GO (`GroundGuideVerdict.clear`): the
 * nearest spot where all of it (its footprint for an echelon) is out of NO-GO, from the S Quick Fix search.
 */
export interface GroundGuideClearGround {
  /** Where it is, Web Mercator metres; null when the search found none within `searchedM`. */
  at: MercXY | null;
  /** Ground metres from the symbol, bearing (degrees clockwise from north) and 8-point compass; null with `at`. */
  distanceM: number | null;
  bearingDeg: number | null;
  compass: string | null;
  /** The verdict there: `ok` (GO), or `near` / `caution` (out of NO-GO, but Marginal / SLOW-GO). */
  verdict: GroundGuideVerdictKind | null;
  /** Ground distance the search covered, metres (for "none within …"). */
  searchedM: number;
}

/** Result of `snapToDeployable()`, also the detail of the `ground-guide-snap` event. */
export interface GroundGuideSnapResult {
  /** True when the symbol was placed at a better spot. */
  moved: boolean;
  /** Where it went, Web Mercator metres (null when nothing was found). */
  at: MercXY | null;
  /** How far it moved in ground metres, and in which compass direction. */
  distanceM: number | null;
  compass: string | null;
  /** Verdict at the new spot. */
  verdict: GroundGuideVerdictKind | null;
  /** Ground distance the search covered, metres (for "nothing within …"). */
  searchedM: number;
  /** Why nothing moved, when `moved` is false. */
  reason?: 'no-draw' | 'not-point' | 'no-ground' | 'loading';
  message: string;
}

/** Stamped on `graphic.attributes.groundGuide` at commit time. */
export interface GroundGuideStamp {
  verdict: GroundGuideVerdictKind;
  profile: GroundGuideProfile;
  classCode: number | null;
  distanceM: number | null;
  fraction: number;
  /** Echelon footprint the verdict was judged on, when there was one. */
  echelon?: string;
  frontageM?: number;
  depthM?: number;
  /** Intergap result against neighbours at the time of placing. */
  spacing?: GroundGuideSpacing['status'];
  /** `enforce` mode would have refused this placement; the user placed it anyway (Shift-click). */
  overridden?: true;
  /** Why, when the host recorded one with `annotateOverride()`. */
  reason?: string;
  /** `profile` was chosen by hand for this draw (P key / `setProfileOverride()`), not derived from the SIDC. */
  profileOverride?: true;
  /** The way out by road to the nearest MSR, asked of the road server just after placing (`traffic.access`). */
  access?: GroundGuideAccess;
}

/** A road server the Ground Guide can ask for the way out (SymbolEngine adapts RoadNetworkEngine / GeoCore). */
export interface GroundGuideRouter {
  /** Travel modes the server offers ("Tracked Vehicle", ...); empty without military routing. */
  travelModes(): string[];
  /** A road route between two lng/lat points under a travel mode ('' = any vehicle). */
  route(from: [number, number], to: [number, number], travelMode: string): Promise<GroundGuideRouteAnswer>;
}

export interface GroundGuideRouteAnswer {
  ok: boolean;
  /** Why not, in the server's words (for a travel mode: the roads that close the way). */
  error?: string;
  km?: number;
  min?: number;
  /** The route, lng/lat paths. */
  paths?: number[][][];
  /** Lowest recorded load class on the way (0 = none recorded) and the road it is on. */
  minLoadClass?: number;
  minLoadClassAt?: string;
  /** The weakest crossing on the way ("bridge class 50-59 (Ravi Bridge)"), '' when none. */
  limitingCrossing?: string;
}

/** The way out, as stamped on the graphic and shown on the card. */
export interface GroundGuideAccess {
  /** `ok` a road route; `on` already on (or by) the MSR; `blocked` no road out for the vehicle; `none` no MSR in reach; `error` server down. */
  status: 'ok' | 'on' | 'blocked' | 'none' | 'error';
  /** Travel mode asked ('' = any vehicle). */
  mode: string;
  /** The road it leads to ("N-5", or its name), and whether it is an MSR. */
  to: string;
  msr: boolean;
  km?: number;
  min?: number;
  /** One line for the card ("3.4 km by Road · 6 min to N-5 (MSR)"). */
  text: string;
  /** A second line: the weakest point on the way, or what closes it. */
  detail?: string;
  /** The routing network the answer came from (network.json dataVersion). */
  dataVersion?: string;
}

export const DEFAULT_GROUND_GUIDE_OPTIONS: GroundGuideOptions = {
  mode: 'advise',
  overlay: { enabled: false, profile: 'auto', opacity: 0.6, boundary: false },
  indicators: { enabled: true },
  footprint: { enabled: true, facing: 'fixed', bearingDeg: 0, size: 'mid', outline: true, spacing: true },
  bundleUrl: '',
  nearThresholdM: 250,
  partialFraction: 0.2,
  blockOn: ['in', 'partial'],
  allowOverride: true,
  showBadge: true,
  units: 'metric',
  snapKey: true,
  profileKey: true,
  logVerdicts: true,
  cacheTiles: 512,
  prefetchMarginTiles: 1,
  maxSamples: 400,
  useWorker: true,
  itg: { enabled: true, radiusKm: 3, max: 2, minLevel: 1 },
  going: { season: 'auto', month: 0, wetMonthMm: 75, rangeKm: 2, movementFor: 'units' },
  card: {
    cursor: 'minimal',
    nearest: 'ranked',
    hint: false,
    goingLines: true,
    movementRose: true,
    soilStrength: false,
    exitStrip: false,
    modeMatrix: false,
    seasonRibbon: false,
    goingMap: false,
    briefKey: true,
    keyNotice: true,
  },
  population: { enabled: true, card: 'scale', flag: true, radiusKm: 5, layer: false, layerOpacity: 0.7 },
  traffic: {
    road: true, roadRadiusKm: 3, legend: 'label', overlay: false, header: 'dry', pill: true, dual: false, rain: 'cone',
    block: 'band', where: 'afterWhy', roadSource: 'network', access: true, accessRadiusKm: 15,
  },
  cover: { enabled: true, card: 'lines', where: 'grotbc', radiusM: 500, focus: true },
  sections: { ground: true, roads: true, buildings: true, weather: true, obstacles: true, style: 'compact', radiusKm: 3, roadDensity: true, roadDensityKm: 5, roadDensityStyle: 'rows', roadDensityLead: 'afterRain', detail: true, gStyle: 'auto', rStyle: 'auto', oStyle: 'auto', bStyle: 'auto', wStyle: 'auto' },
  speed: { enabled: true, card: 'line', light: 'day', road: 'convoy', load: 'combat', mover: 'auto', legend: true },
  scope: { enabled: true, side: 'right', tab: true, topPx: 54 },
  extended: { keys: true, lasts: 'symbol', threat: 'front', bearingDeg: 0, sectorDeg: 90, at: null, marker: true, radiusKm: 5, mapFan: true, mapEnemy: true, mapSight: true, mapApproaches: true, mapBetter: true, overlay: 'auto', ipb: { readFor: 'defence', mover: 'auto', season: 'coding', avlbSpanM: 18, paint: 'hatch', apchs: true, hq: 'auto', mapCorridors: true, labels: 'auto', createAs: 'attack', fire: true, mapFire: true, proforma: true, pfHead1: '', pfHead2: '', decision: true, mapDecision: true, reactionH: 0, hHour: '', air: true, mapAir: true, airBand: 'contour', lzClass: 4, lzPoints: 4, template: 'auto', mapTemplate: true }, eye: 'auto', surface: true },
  aor: { keys: true, scale: 'spot', layout: 'deductions', style: 'trace', orient: 'north', source: 'echelon', box: null, echelon: 'auto', leadKm: 4, corridorM: 0, profile: 'tracked' },
};

/** Tile layer names for a profile under a manifest (`dist` is null when the bundle has no layer for it). */
export function layerNames(m: TerrainManifest, profile: GroundGuideProfile): { cls: string; dist: string | null } {
  const cls = m.layers?.class ?? 'class';
  const tpl = m.layers?.dist ?? 'dist_{profile}';
  const dist = profile !== 'exempt' && m.profiles.includes(profile) ? tpl.replace('{profile}', profile) : null;
  return { cls, dist };
}

export const NODATA_CLASS = 255;
export const DIST_INSIDE = 0;
export const DIST_FAR = 254;
export const DIST_NODATA = 255;
