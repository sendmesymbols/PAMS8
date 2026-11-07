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
  /** Write the class and distance at the end of the line. */
  labels: boolean;
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
  indicators: { enabled: true, labels: true },
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
    goingLines: true,
    movementRose: true,
    soilStrength: false,
    exitStrip: false,
    modeMatrix: false,
    seasonRibbon: false,
    goingMap: false,
    briefKey: true,
  },
  population: { enabled: true, card: 'scale', flag: true, radiusKm: 5, layer: false, layerOpacity: 0.7 },
  traffic: {
    road: true, roadRadiusKm: 3, legend: 'label', overlay: false, header: 'dry', pill: true, dual: false, rain: 'cone',
    block: 'band', where: 'afterWhy', roadSource: 'network', access: true, accessRadiusKm: 15,
  },
  cover: { enabled: true, card: 'lines', where: 'grotbc', radiusM: 500, focus: true },
  sections: { ground: true, roads: true, buildings: true, weather: true, obstacles: true, style: 'compact', radiusKm: 3, roadDensity: true, roadDensityKm: 5, roadDensityStyle: 'rows', roadDensityLead: 'afterRain', detail: true, gStyle: 'auto', rStyle: 'auto', oStyle: 'auto', bStyle: 'auto', wStyle: 'auto' },
  speed: { enabled: true, card: 'line', light: 'day', road: 'convoy', load: 'combat', mover: 'auto', legend: true },
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
