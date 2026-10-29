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

/** Map overlay that paints the terrain bundle as go / caution / near / no-go. */
export interface PlacementOverlayOptions {
  enabled: boolean;
  /** Mobility profile to paint; `auto` follows the armed symbol (last armed one when idle). */
  profile: 'auto' | PlacementProfile;
  /** Layer opacity, 0–1. */
  opacity: number;
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
  overlay: { enabled: false, profile: 'auto', opacity: 0.6 },
  indicators: { enabled: true, labels: true },
  bundleUrl: '',
  nearThresholdM: 250,
  partialFraction: 0.2,
  blockOn: ['in', 'partial'],
  showBadge: true,
  logVerdicts: true,
  cacheTiles: 256,
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
