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
}

export interface PlacementOptions {
  mode: PlacementMode;
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
}

/** One terrain reading. `null` = no tile loaded / no coverage. */
export interface TerrainSample {
  classCode: number | null;
  distanceM: number | null;
}

export interface PlacementVerdict {
  verdict: PlacementVerdictKind;
  profile: PlacementProfile;
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
}

/** Stamped on `graphic.attributes.placement` at commit time. */
export interface PlacementStamp {
  verdict: PlacementVerdictKind;
  profile: PlacementProfile;
  classCode: number | null;
  distanceM: number | null;
  fraction: number;
}

export const DEFAULT_PLACEMENT_OPTIONS: PlacementOptions = {
  mode: 'advise',
  bundleUrl: '',
  nearThresholdM: 250,
  partialFraction: 0.2,
  blockOn: ['in', 'partial'],
  showBadge: true,
  logVerdicts: true,
  cacheTiles: 256,
  prefetchMarginTiles: 1,
  maxSamples: 400,
};

export const NODATA_CLASS = 255;
export const DIST_INSIDE = 0;
export const DIST_FAR = 254;
export const DIST_NODATA = 255;
