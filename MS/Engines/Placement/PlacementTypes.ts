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

/** A value `setOptions()` did not take as given: ignored (it was invalid) or moved into range. */
export interface PlacementOptionIssue {
  /** Setting path, e.g. `placement.units`. */
  path: string;
  value: unknown;
  reason: string;
}

/** How distances are written in the advice: metres / kilometres, yards / miles, or metres / nautical miles. */
export type PlacementUnits = 'metric' | 'imperial' | 'nautical';

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
  /** Optional one-sentence note on this ground, shown when no profile-specific reason is given. */
  note?: string;
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
   * ("Tracks bog down in marsh and wetland soils."). Authored by the rule owner; the advisor shows it
   * under the verdict and never writes any of its own.
   */
  why?: Record<string, string>;
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
  /** In `enforce` mode, holding Shift while clicking places the symbol anyway, stamped `overridden`. Off = a hard block. */
  allowOverride: boolean;
  showBadge: boolean;
  /**
   * Units for the distances in the card, messages, key and panel. Display only: the data, thresholds
   * (`nearThresholdM`) and event payloads stay in metres. One setting for the whole page.
   */
  units: PlacementUnits;
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
  /**
   * `contested` only: the stretches of the line / area edge (or footprint outline) that lie in no-go ground,
   * as Web Mercator point runs, for the map to colour where the shape needs fixing.
   */
  stretches?: MercXY[][];
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
  /** Set when the search for the nearest terrain of the other kind found none within this many metres. */
  noneWithinM?: number;
  /** Set while tiles the shape needs are still arriving, so the verdict is provisional. */
  loading?: boolean;
  /** Set when an echelon symbol was judged on its footprint rather than its point. */
  footprint?: PlacementFootprintInfo | null;
  /** Set alongside `footprint` when the intergap check ran. Advisory: never changes `verdict`. */
  spacing?: PlacementSpacing | null;
  /** Set while drawing a point the snap key can move to usable ground (the verdict is bad and the quick fix is on). */
  snappable?: boolean;
  /** Set while drawing when `enforce` mode would refuse this verdict at the click. */
  blocked?: boolean;
  /** Set alongside `blocked` when holding Shift at the click places it anyway. */
  overridable?: boolean;
  /** Set while drawing: the judged profile was chosen by hand rather than derived from the SIDC. */
  profileOverride?: boolean;
  /** Set while drawing when the P key can change the judged profile. */
  profileKey?: boolean;
  /** The rule behind the verdict, in the rule owner's words (rules.json `why` / class `note`); null when the bundle has none. */
  reason?: string | null;
  /** Set on an `unknown` verdict when a tile it needs is still on its way (as opposed to no coverage). */
  waiting?: boolean;
}

/** One symbol judged by `auditPlacements()` / `explain()`. */
export interface PlacementAuditEntry {
  graphic: any;
  id: string | null;
  name: string;
  sidc: string | null;
  profile: PlacementProfile;
  profileLabel: string;
  verdict: PlacementVerdictKind;
  message: string;
  detail: string | null;
  /** The rule behind the verdict in the rule owner's words, when the bundle gives one. */
  rule: string | null;
  /** `profile` was set by hand when the symbol was placed, so the audit keeps judging it that way. */
  profileOverride: boolean;
  fraction: number;
  /** Intergap message when the spacing rule is not met. */
  spacing: string | null;
  /** What the stamp said before this check (null = never stamped, e.g. loaded from a plan). */
  previous: PlacementVerdictKind | null;
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

export interface PlacementAudit {
  /** Symbols judged. */
  checked: number;
  /** Symbols that are not terrain-bound (air, sea, …) or have no usable geometry. */
  exempt: number;
  /** Symbols outside the terrain bundle's coverage. */
  outside: number;
  /** Symbols whose tiles never arrived, so they are not judged. */
  unchecked: number;
  counts: Partial<Record<PlacementVerdictKind, number>>;
  entries: PlacementAuditEntry[];
  /** `entries` that are problems, worst first. */
  problems: PlacementAuditEntry[];
}

/** Whether the advisor has terrain data, for hosts that want to show it (also on `placement-state-change`). */
export interface PlacementStatus {
  state: 'disabled' | 'no-bundle-url' | 'loading' | 'ready' | 'failed';
  /** Why the bundle failed to load (`failed` only). */
  error: string | null;
  /** Milliseconds until the next automatic retry, or null when none is scheduled. */
  retryInMs: number | null;
}

/** Result of `snapToDeployable()`, also the detail of the `placement-snap` event. */
export interface PlacementSnapResult {
  /** True when the symbol was placed at a better spot. */
  moved: boolean;
  /** Where it went, Web Mercator metres (null when nothing was found). */
  at: MercXY | null;
  /** How far it moved in ground metres, and in which compass direction. */
  distanceM: number | null;
  compass: string | null;
  /** Verdict at the new spot. */
  verdict: PlacementVerdictKind | null;
  /** Ground distance the search covered, metres (for "nothing within …"). */
  searchedM: number;
  /** Why nothing moved, when `moved` is false. */
  reason?: 'no-draw' | 'not-point' | 'no-ground' | 'loading';
  message: string;
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
  /** `enforce` mode would have refused this placement; the user placed it anyway (Shift-click). */
  overridden?: true;
  /** Why, when the host recorded one with `annotateOverride()`. */
  reason?: string;
  /** `profile` was chosen by hand for this draw (P key / `setProfileOverride()`), not derived from the SIDC. */
  profileOverride?: true;
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
