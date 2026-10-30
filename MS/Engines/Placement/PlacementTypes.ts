/**
 * PlacementTypes.ts
 *
 * Shared types for the Placement Advisor — the optional "is this deployable
 * terrain?" check that runs while a symbol is drawn. See
 * MS/Docs/15-placement-advisor.md for the bundle format these mirror.
 */

/** Mobility class a symbol is evaluated as. `exempt` = never terrain-bound. */
export type PlacementProfile =
  | 'dismounted'
  | 'wheeled'
  | 'tracked'
  | 'vessel'
  | 'generic'
  | 'exempt';

export type PlacementVerdictKind =
  | 'ok'
  | 'near'
  | 'caution'
  | 'partial'
  | 'in'
  | 'unknown'
  | 'exempt'
  | 'off';

export type PlacementMode = 'off' | 'advise' | 'enforce';

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
  layers?: { class?: string; dist?: string };
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
}

export interface TerrainClassDef {
  name: string;
  label: string;
}

export interface TerrainProfileRule {
  label?: string;
  /** Class codes that are no-go for this profile. */
  nogo?: number[];
  /** Class codes that are deployable with a warning. */
  caution?: number[];
  /** When set, every class NOT listed here is no-go (vessels need water). */
  requires?: number[];
}

/** `rules.json` at the bundle root. */
export interface TerrainRules {
  version?: string;
  classes: Record<string, TerrainClassDef>;
  profiles: Record<string, TerrainProfileRule>;
  profileOverrides?: {
    /** 2-digit 2525D symbol set → profile. */
    symbolSets?: Record<string, string>;
    /** `symbolSet:entityPrefix` → profile (entity prefix 2–6 digits). */
    entities?: Record<string, string>;
  };
  /**
   * 2-digit 2525D echelon code → ground footprint, overriding the doctrine table compiled
   * into PlacementFootprint.ts. Each range is `[min, max]` metres (or one number for a fixed value).
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
}

/** How the footprint is oriented, since a placed symbol has no facing of its own. */
export type PlacementFacingMode =
  /** One rectangle, frontage across `bearingDeg`. */
  | 'fixed'
  /** Worst result of four facings (0°, 45°, 90°, 135° — a centred rectangle repeats every 180°). */
  | 'worst4'
  /** Orientation-free disc whose diameter is the frontage. */
  | 'circle';

/** Which end of an echelon's doctrinal range the footprint uses. */
export type PlacementFootprintSize = 'min' | 'mid' | 'max';

/** Echelon footprint: a unit is judged on the ground it occupies, not on its click point. */
export interface PlacementFootprintOptions {
  enabled: boolean;
  facing: PlacementFacingMode;
  /** Direction the frontage faces, degrees clockwise from north (used by `fixed`). */
  bearingDeg: number;
  size: PlacementFootprintSize;
  /** Draw the footprint on the map while placing. */
  outline: boolean;
  /** Compare against same-echelon symbols already on the map for the minimum intergap. */
  spacing: boolean;
}

/** Map overlay that paints the terrain bundle as go / caution / near / no-go. */
export interface PlacementOverlayOptions {
  enabled: boolean;
  /** Mobility profile to paint; `auto` follows the armed symbol (last armed one when idle). */
  profile: 'auto' | PlacementProfile;
  /** Layer opacity, 0–1. */
  opacity: number;
  /** Also draw the bundle's boundary outline (`manifest.boundary.file`): national outline, provinces, Line of Control. */
  boundary: boolean;
}

/** Lines drawn on the map from the symbol to the terrain that makes it undeployable. */
export interface PlacementIndicatorOptions {
  enabled: boolean;
  /** Write the class and distance at the end of the line. */
  labels: boolean;
}

export interface PlacementOptions {
  mode: PlacementMode;
  overlay: PlacementOverlayOptions;
  indicators: PlacementIndicatorOptions;
  footprint: PlacementFootprintOptions;
  /** Folder that holds manifest.json; '' disables the engine. */
  bundleUrl: string;
  /** Deployable samples closer than this to no-go yield `near`. */
  nearThresholdM: number;
  /** Line/area share of no-go samples at which the verdict becomes `partial`. */
  partialFraction: number;
  /** Verdicts refused by `enforce` mode. */
  blockOn: PlacementVerdictKind[];
  showBadge: boolean;
  logVerdicts: boolean;
  cacheTiles: number;
  prefetchMarginTiles: number;
  /** Cap on samples per geometry; the step widens to stay under it. */
  maxSamples: number;
  /** Decode tiles and paint the overlay in a Web Worker (falls back to the main thread if unavailable). */
  useWorker: boolean;
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
 * The advisor draws these itself when `indicators.enabled` is on.
 */
export interface PlacementIndicator {
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
}

/** The closest terrain of the opposite kind: no-go ground near a deployable point, or deployable ground near a no-go point. */
export interface PlacementNearest {
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
export interface PlacementFootprintInfo {
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
  facing: PlacementFacingMode;
  /** The footprint outline in Web Mercator metres: a ring (rectangle / disc) or a 2-point line. */
  ring: MercXY[];
}

/** Result of the intergap check against same-echelon symbols already on the map. */
export interface PlacementSpacing {
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

export interface PlacementVerdict {
  verdict: PlacementVerdictKind;
  profile: PlacementProfile;
  /** Human label of the profile ("Wheeled vehicles"). */
  profileLabel: string;
  /** Second line: why it is not deployable / what is nearby. */
  detail: string | null;
  nearest: PlacementNearest | null;
  /** Lines to the terrain behind the verdict (empty for ok / caution / unknown). */
  indicators: PlacementIndicator[];
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
  /** Set when an echelon symbol was judged on its footprint rather than its point. */
  footprint?: PlacementFootprintInfo | null;
  /** Set alongside `footprint` when the intergap check ran. Advisory: never changes `verdict`. */
  spacing?: PlacementSpacing | null;
}

/** Stamped on `graphic.attributes.placement` at commit time. */
export interface PlacementStamp {
  verdict: PlacementVerdictKind;
  profile: PlacementProfile;
  classCode: number | null;
  distanceM: number | null;
  fraction: number;
  /** Echelon footprint the verdict was judged on, when there was one. */
  echelon?: string;
  frontageM?: number;
  depthM?: number;
  /** Intergap result against neighbours at the time of placing. */
  spacing?: PlacementSpacing['status'];
}

export const DEFAULT_PLACEMENT_OPTIONS: PlacementOptions = {
  mode: 'advise',
  overlay: { enabled: false, profile: 'auto', opacity: 0.6, boundary: false },
  indicators: { enabled: true, labels: true },
  footprint: { enabled: true, facing: 'fixed', bearingDeg: 0, size: 'mid', outline: true, spacing: true },
  bundleUrl: '',
  nearThresholdM: 250,
  partialFraction: 0.2,
  blockOn: ['in', 'partial'],
  showBadge: true,
  logVerdicts: true,
  cacheTiles: 512,
  prefetchMarginTiles: 1,
  maxSamples: 400,
  useWorker: true,
};

/** Tile layer names for a profile under a manifest (`dist` is null when the bundle has no layer for it). */
export function layerNames(m: TerrainManifest, profile: PlacementProfile): { cls: string; dist: string | null } {
  const cls = m.layers?.class ?? 'class';
  const tpl = m.layers?.dist ?? 'dist_{profile}';
  const dist = profile !== 'exempt' && m.profiles.includes(profile) ? tpl.replace('{profile}', profile) : null;
  return { cls, dist };
}

export const NODATA_CLASS = 255;
export const DIST_INSIDE = 0;
export const DIST_FAR = 254;
export const DIST_NODATA = 255;
