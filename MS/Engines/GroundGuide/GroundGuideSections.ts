/**
 * GroundGuideSections.ts
 *
 * The GROTBC data the card did not show before (2026-11-05), read at and round the point being placed. Pure: no
 * DOM, no fetching; the engine passes a pixel reader, the feature tiles and the climate grid in.
 *
 *   G Ground     terrain type (`terrain`), relief: elevation and slope (`elev_hi` / `elev_lo`, 3 x 3 gradient), landform
 *                (`landform`), the nearest change of terrain type, high ground nearby (features with `e`), the named area
 *                (GeoNames / NCGDB: plains, plateaus, deserts, valleys, hill ranges, forests), water sources (rules.json
 *                `grotbc.water.kinds` + wells) and the nearest named river, canal or stream.
 *   R Roads      the route at the point or the nearest within 500 m (`route`: type, load-class tier, MSR bit), checked
 *                against the mode with rules.json `grotbc.tankable` (class 60+ tankable, 50-59 Al-Zarrar only); the
 *                nearest crossing (bridge, ford, ferry), railway station or line, and airfield or helipad; road network
 *                density round the point (GroundGuideRoadDensity: km/km², all-weather, MSR, ways out). Added 2026-11-06:
 *                the ways across the railway (level crossings and railway bridges from the class layer, railway
 *                tunnels from the features) and transport hubs (bus stands, toll plazas).
 *   B Buildings  building density, footprint size and height (`bld`, Open Buildings + GHSL), kacha huts and temporary
 *                huts (`hut`, NCGDB symbols), the nearest services (health, police, school, government) and security
 *                installations (posts, forts, border posts, cantonments).
 *   O Obstacles  (added 2026-11-06) the nearest natural and man-made obstacle by class (rules.json `classes[c].origin`
 *                and the `O` letter), with its effect for the mode (the profile's NO-GO / SLOW-GO lists); wet ground at
 *                the point (`wet`); the nearest canal with its width, depth and bank height, river reach (bed, depth,
 *                current), dam / barrage / headworks and levee; roads closed by season or with landslide sites nearby.
 *   Also (2026-11-06): R the recorded condition, closures, landslides, load code and width of the nearest road, and its
 *                named route (routes.json: from, to, length, MSR); G the nearest ridgeline; B the admin area, map
 *                sheet and border (admin.geojson, sheets.json, boundaries.geojson), the nearest settlement and its
 *                size class, utilities and landmarks (protected sites: mosques, shrines, temples, churches, graveyards).
 *   W Weather    the month's normals (tmax / tmin, rain, wind) and the year (rain, monsoon share, frost, hot and wet
 *                months) from the climate grid (WorldClim 1970-2000).
 *
 * Every label comes from the bundle (rules.json codebooks, features/index.json kinds). Every threshold that decides
 * something comes from rules.json. Safety first (see docs/15): a load class that is not recorded is treated as not
 * tankable until checked, and a fair-weather surface is said to turn SLOW-GO after rain.
 */

import type { ClimateNormals } from './GroundGuideGoing';
import type { FeatureHit } from './GroundGuideFeatures';
import type { MercXY } from './GroundGuideTypes';
import type { RoadDensityTotals } from './GroundGuideRoads';
import { roadDensityKey, roadDensityReading, type RoadDensityReading, type RoadDensityRules } from './GroundGuideRoadDensity';
import type { RoadDensityLead, RoadDensityStyle } from './GroundGuideRoadDensityView';
import type { FeatureRoadHit } from './GroundGuideFeatures';
import type { PlaceAdmin, PlaceBorder, PlaceRoute, PlaceSheet } from './GroundGuidePlaceData';

export type SectionsStyle = 'lines' | 'compact' | 'brief';
export const SECTIONS_STYLES: readonly SectionsStyle[] = ['lines', 'compact', 'brief'];

/**
 * Per-section card styles (2026-11-06), every one kept so the owner can compare them live
 * (ground-guide-sections-options.html shows them side by side). `auto` follows `sections.style`
 * (compact -> line, lines -> rows, brief -> nothing on the card); `line` and `rows` are those two looks for one section.
 *   G  relief: a cross-section with the point on it, the slope band gauge and the high ground  ·  chips: one chip each
 *   R  shield: the road as a sign (number, name, from - to, record chips)  ·  verdict: the check for the mode in large type
 *   O  tiles: natural beside man-made, bordered by their effect  ·  gap: the nearest canal or river drawn to its width and depth
 *   B  where: tehsil, district, sheet and border first  ·  protected: protected sites and services (no-strike, collateral)
 *   W  year: twelve months of temperature range and rain  ·  icons: temperature, rain and wind in large figures
 */
export type SectionCardStyle = 'auto' | 'line' | 'rows' | 'off';
export type GroundCardStyle = SectionCardStyle | 'relief' | 'chips';
export type RoadsCardStyle = SectionCardStyle | 'shield' | 'verdict';
export type ObstaclesCardStyle = SectionCardStyle | 'tiles' | 'gap';
export type BuildingsCardStyle = SectionCardStyle | 'where' | 'protected';
export type WeatherCardStyle = SectionCardStyle | 'year' | 'icons';
export const G_STYLES: readonly GroundCardStyle[] = ['auto', 'line', 'rows', 'relief', 'chips'];
export const R_STYLES: readonly RoadsCardStyle[] = ['auto', 'line', 'rows', 'shield', 'verdict'];
export const O_STYLES: readonly ObstaclesCardStyle[] = ['auto', 'line', 'rows', 'tiles', 'gap'];
export const B_STYLES: readonly BuildingsCardStyle[] = ['auto', 'line', 'rows', 'where', 'protected'];
export const W_STYLES: readonly WeatherCardStyle[] = ['auto', 'line', 'rows', 'year', 'icons'];

export interface SectionStyles {
  g: GroundCardStyle;
  r: RoadsCardStyle;
  o: ObstaclesCardStyle;
  b: BuildingsCardStyle;
  w: WeatherCardStyle;
}

export interface GroundGuideSectionsOptions {
  /** G: terrain type, relief, landform, high ground, named area, water. */
  ground: boolean;
  /** R: the route at the point and how it suits the mode; crossings, rail and air nearby. */
  roads: boolean;
  /** B: buildings, huts, services and security installations. */
  buildings: boolean;
  /** W: the month's weather and the year's climate. */
  weather: boolean;
  /** O: the nearest natural and man-made obstacle, wet ground, gaps (canal, river reach), dams, levees, closures. */
  obstacles: boolean;
  /** `lines` (2-5 lines a section), `compact` (one line a section), `brief` (only in the Ground Brief). */
  style: SectionsStyle;
  /** Per-section card style; `auto` follows `style`. */
  gStyle: GroundCardStyle;
  rStyle: RoadsCardStyle;
  oStyle: ObstaclesCardStyle;
  bStyle: BuildingsCardStyle;
  wStyle: WeatherCardStyle;
  /** How far the sections look for features (high ground, water, crossings, services), km. */
  radiusKm: number;
  /** R: road network density round the point (km of road per km², all-weather share, MSR, ways out). */
  roadDensity: boolean;
  /** The circle the road density is measured in, radius km. */
  roadDensityKm: number;
  /** How the card shows it (GroundGuideRoadDensityView, D1-D7); the Brief always shows it in full. */
  roadDensityStyle: RoadDensityStyle;
  /** Which band the card leads with when tracks lift the total a band: after rain (safety), dry, or both. */
  roadDensityLead: RoadDensityLead;
  /**
   * Under each one-line section (G R O B W), a small grid of the rows the line leaves out: what "A few rows" and the
   * Brief show (G ridge, river, area, water, going by mode, soil strength; R named road, record, crossings, rail, air;
   * O canal, river, dam, levee, closures; B buildings, services, security, place, landmarks, utilities, admin, sheet,
   * border, ages; W the year). Added 2026-11-06; the one line itself is unchanged.
   */
  detail: boolean;
}

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Slope bands (doc 16 §3.3): Level 0-3, Gentle 3-7, Sloping 7-15, Moderate 15-30, Steep over 30 degrees. */
export function slopeBand(deg: number): string {
  return deg < 3 ? 'Level' : deg < 7 ? 'Gentle' : deg < 15 ? 'Sloping' : deg < 30 ? 'Moderate' : 'Steep';
}

/** Building height class (value >> 6 of `bld`), as the pipeline names it (tools/terrain-pipeline/scripts/buildings.py HEIGHT_LABEL). */
export const BLD_HEIGHT: Record<number, string> = {
  0: 'Height not known / under 3 m',
  1: 'Low (3 to 6 m, 1 to 2 storeys)',
  2: 'Medium (6 to 12 m, 2 to 4 storeys)',
  3: 'High (12 m and over, multi-storey)',
};

/** Route types (rules.json `grotbc.layers.route.types`) by what they are. */
const ROAD_TYPES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22]);
const METALLED_TYPES = new Set([17, 18, 19, 20, 21, 22]);
const TRACK_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 15, 16]);
const RAIL_TYPES = new Set([8, 9, 10, 11, 12, 13]);

/** Feature kind keys (features/index.json) used by each line. */
export const KINDS = {
  high: new Set(['trig_station', 'spot_height', 'bench_mark', 'mountain', 'peak', 'hill', 'knoll', 'plateau']),
  area: new Set(['landform_name', 'mountain', 'dune', 'forest_name', 'locality', 'glacier', 'vegetation_name']),
  waterExtra: new Set(['well', 'hand_pump', 'tank_overhead', 'tank_seasonal']),
  waterNamed: new Set(['stream_name', 'canal_name', 'lake', 'waterfall', 'river_reach']),
  waterLines: new Set(['river', 'canal']),
  crossing: new Set(['bridge', 'bridge_iron', 'boat_bridge', 'viaduct', 'ford', 'ferry', 'foot_bridge']),
  rail: new Set(['rail_station']),
  railLines: new Set(['railway']),
  /** Railway tunnels (features); rail bridges and level crossings come from the class layer (RAIL_CROSSING_CLASSES). */
  railTunnel: new Set(['rail_tunnel']),
  /** Transport hubs: bus stands and toll plazas. */
  transport: new Set(['bus_stand', 'toll_plaza']),
  /** Junctions of main roads (`mx` ways out along highways) and named junctions (chowks). */
  mainJunction: new Set(['main_junction']),
  namedJunction: new Set(['road_junction']),
  /** Fuel: petrol pumps. */
  fuel: new Set(['petrol_pump']),
  /** The kinds a chokepoint on an MSR can be (features flagged `ig` C): crossings, tunnels, passes, dams. */
  choke: new Set(['bridge', 'bridge_iron', 'boat_bridge', 'viaduct', 'ford', 'ferry', 'tunnel', 'pass', 'dam', 'barrage', 'headworks']),
  lake: new Set(['lake']),
  /** Former "Data only" kinds (added 2026-11-06): km stones, culverts, canal works, industry, deserted sites, lodging, vet hospitals, boundary pillars, named marshes. */
  kmRoad: new Set(['km_road']),
  kmRail: new Set(['km_rail']),
  kmCanal: new Set(['km_canal']),
  culvert: new Set(['culvert']),
  canalWorks: new Set(['aqueduct', 'siphon', 'canal_tunnel']),
  industry: new Set(['mine', 'mine_shaft', 'kiln', 'chimney']),
  deserted: new Set(['deserted_site']),
  lodging: new Set(['rest_house']),
  vet: new Set(['vet_hospital']),
  pillar: new Set(['boundary_pillar']),
  marsh: new Set(['marsh']),
  depression: new Set(['depression']),
  /** Underground and enclosed cover (C): caves, bunkers, trenches, road and railway tunnels. */
  shelter: new Set(['cave', 'bunker', 'trench', 'tunnel', 'rail_tunnel']),
  air: new Set(['helipad', 'airfield', 'landing_strip', 'airport', 'air_base', 'landing_ground', 'road_runway', 'runway']),
  health: new Set(['hospital', 'bhu', 'dispensary']),
  police: new Set(['police_station']),
  school: new Set(['school']),
  government: new Set(['government_office', 'post_office']),
  security: new Set(['post', 'border_post', 'fort', 'cantonment', 'watch_tower', 'firing_range', 'air_target']),
  ridge: new Set(['ridgeline']),
  dam: new Set(['dam', 'barrage', 'headworks']),
  reach: new Set(['river_reach']),
  canalLines: new Set(['canal']),
  levee: new Set(['levee']),
  utilities: new Set(['grid_station', 'mast', 'wind_tower', 'oil_gas_well', 'oil_tank', 'telecom_booster', 'telephone_exchange', 'wireless_station', 'solar_plant']),
  /** G (added 2026-11-06, NCGDB Soil_Point / Soil_Line / Glacier_Line): ground the map marks with a symbol. */
  groundSym: new Set(['scree', 'broken_ground', 'stony_waste', 'quarry', 'earth_slide', 'moraine', 'crevasse', 'ice_pinnacles', 'sand_plain']),
  /** G: dune fields (one point per ~2 km cell: spacing and orientation of the dune lines on the 1:50k map). */
  dunes: new Set(['dune_field']),
  /** G: the sheet's own notes (Annotation_): going, water, vegetation, ground. */
  notes: new Set(['note_going', 'note_water', 'note_vegetation', 'note_ground']),
  /** O (added 2026-11-06, OpenStreetMap): power lines, pipelines, walls and fences. */
  osmLines: new Set(['power_line', 'pipeline', 'wall_fence']),
  /** G: the sheet's wind arrows (`wd` axis); B: national park boundaries. */
  wind: new Set(['wind_arrow']),
  park: new Set(['park_boundary']),
  landmarks: new Set(['mosque', 'tomb', 'temple', 'church', 'eidgah', 'graveyard_pt', 'market', 'bank', 'mill', 'stadium', 'industrial_area', 'camp', 'park']),
  places: new Set(['city', 'district_hq', 'town', 'village_imp', 'village']),
};
/** Class names (rules.json `classes[c].name`) the G scan looks for round the point. */
const TREE_CLASSES = new Set(['tree_cover', 'forest', 'orchard', 'walled_orchard']);
const LAKE_CLASSES = new Set(['water_permanent']);
const RIVERBED_CLASSES = new Set(['dry_riverbed']); // seasonal water comes through the wet layer (G Wet row)
const SNOW_CLASSES = new Set(['snow_ice']);
/** Class names (rules.json `classes[c].name`) of the ways across a railway: where vehicles or men cross the line. */
const RAIL_CROSSING_CLASSES = new Set(['rail_bridge', 'level_crossing']);
/** Protected sites (no-strike, collateral): named first on the Landmarks line. */
const PROTECTED = new Set(['mosque', 'tomb', 'temple', 'church', 'eidgah', 'graveyard_pt']);

/** Settlement size classes by people, as the pipeline sets them (tools/terrain-pipeline/scripts/settlements.py SIZE_CLASSES). */
const SIZE_CLASSES: Array<[number, string]> = [
  [1_000_000, 'Metropolitan city'],
  [500_000, 'Large city'],
  [100_000, 'Mid-size city'],
  [20_000, 'Town'],
  [5_000, 'Large village'],
  [500, 'Village'],
  [0, 'Hamlet'],
];
export function sizeClass(people: number): string {
  return SIZE_CLASSES.find(([lo]) => people >= lo)?.[1] ?? 'Hamlet';
}
/** `t` subtypes of the `mountain` / `locality` / `dune` kinds that name an area rather than one hill or village lands. */
const AREA_SUBTYPES = new Set(['mountain range', 'hills', 'ridge', 'region', 'tribal area', 'sand sea', 'plain', 'plateau', 'desert', 'valley', 'upland', 'gorge']);

export interface SectionPlace {
  label: string;
  name: string | null;
  distanceM: number;
  compass: string;
}

export interface GroundReading {
  terrain: { code: number; label: string } | null;
  /** The nearest different terrain type along eight rays to the radius. */
  terrainChange: { label: string; distanceM: number; compass: string } | null;
  elevationM: number | null;
  slopeDeg: number | null;
  slopeBand: string | null;
  /** The slope was read on an overview tile (map zoomed out): a mean, so gentler than the ground. */
  slopeApprox: boolean;
  landform: string | null;
  high: (SectionPlace & { elevationM: number; aboveM: number | null }) | null;
  area: SectionPlace | null;
  water: SectionPlace[];
  namedWater: SectionPlace | null;
  /** The nearest ridgeline (ground.py, from the DEM): crest height and length. */
  ridge: { crestM: number | null; lengthKm: number | null; distanceM: number; compass: string } | null;
  /**
   * Added 2026-11-06 (the former "Partly" rows): the ground class at the point and the area's vegetation density
   * (cc concealment, 0-3, an area figure); the nearest trees, permanent water, riverbed or seasonal water and snow
   * (class layer, within 3 km); the wet ground at the point and the nearest (`wet` layer); the nearest named lake.
   */
  land: { label: string; vegetation: number | null } | null;
  trees: SectionPlace | null;
  lake: SectionPlace | null;
  riverbed: SectionPlace | null;
  snow: SectionPlace | null;
  wetHere: string | null;
  wetNear: SectionPlace | null;
  /** The nearest named marsh / swamp or lake bed (kind 156, GeoNames) within 10 km. */
  marsh: SectionPlace | null;
  /**
   * Added 2026-11-06, from the bundle's 30 m elevation (Copernicus GLO-30): the way the slope faces (null on level
   * ground), how broken the ground is round the point, and the military crest of the slope it is on.
   */
  aspect: { deg: number; compass: string } | null;
  rough: { level: 0 | 1 | 2 | 3; label: string; residualM: number } | null;
  crest: MilitaryCrest | null;
  /** Added 2026-11-06 (NCGDB Soil_Line / Soil_Point): the dune field at or near the point. */
  dunes: DuneField | null;
  /** Ground the map marks with a symbol (scree, broken rocky ground, stony waste, quarry, slide, moraine, crevasses ...), nearest of each, up to three. */
  groundSym: SectionPlace[];
  /**
   * The sheet's wind arrows within 25 km (NCGDB Soil_Point 16): the axis the wind blows along (the mean of up to five
   * arrows), the nearest arrow's distance. Which end it blows from is not recorded, so only the axis is given.
   */
  wind: { axis: string; arrows: number; distanceM: number; compass: string } | null;
  /** The sheet's own notes within 2 km (Annotation_): nearest of each group, nearest first. `name` is the text as written. */
  notes: Array<SectionPlace & { group: 'going' | 'water' | 'vegetation' | 'ground' }>;
}

/**
 * The military crest of the slope at the point (from the DEM): along the way the slope faces, the highest point from
 * which a man standing (2 m eye height) sees all the way to the foot of the slope. `where` says where the point is:
 * `above` (between the crest and the military crest: the slope below is partly hidden), `on`, or `below` (on the
 * forward slope under it: the foot is in view).
 */
export interface MilitaryCrest {
  where: 'above' | 'on' | 'below';
  /** From the point to the military crest. */
  distanceM: number;
  compass: string;
  /** The topographic crest (the top of the slope) above the point. */
  topDistanceM: number;
  topCompass: string;
  /** The foot of the slope (where it levels out), from the point, and the drop from the top to the foot. */
  footDistanceM: number;
  dropM: number;
  /** The way the slope faces (forward to that side). */
  faces: string;
  /** The profile from the top (index 0) to the foot, one sample every `stepM`; `iP` the point, `iM` the military crest. */
  profile: number[];
  stepM: number;
  iP: number;
  iM: number;
}

export interface DuneField {
  /** Mean spacing of the dune lines (m), null when the cell has only dune symbols. */
  spacingM: number | null;
  /** The dune lines' axis ("NE–SW"), null when they run no single way. */
  axis: string | null;
  /** Star dunes dominate the cell (high, irregular dunes). */
  star: boolean;
  /** The point is in the field (the nearest cell is within ~1.5 km) rather than near it. */
  inField: boolean;
  distanceM: number;
  compass: string;
}

export interface RoadsReading {
  /** The route at the point (`on`), else the nearest within 500 m. Null when there is none. */
  route: {
    on: boolean;
    type: number;
    typeLabel: string;
    tier: number;
    tierLabel: string;
    msr: boolean;
    distanceM: number;
    compass: string;
  } | null;
  /** The route checked against the mode with rules.json (null when no rule applies to the mode). */
  check: { level: 'ok' | 'warn' | 'stop' | 'unknown'; text: string } | null;
  crossing: SectionPlace | null;
  rail: SectionPlace | null;
  /**
   * The nearest ways across or under a railway: a level crossing (where vehicles cross the line), a railway bridge
   * (trains and men on foot, not vehicles; class layer, within 2 km) and a railway tunnel (features). Nearest first.
   */
  railCrossings: Array<SectionPlace & { note: string | null }>;
  /** The nearest bus stand and toll plaza (transport hubs). */
  transport: SectionPlace[];
  /** Chokepoints on an MSR (features flagged `ig` C) within 10 km, nearest first, up to two. */
  chokepoints: SectionPlace[];
  /** The nearest junction of main roads (`ways` = ways out along highways, `mx`) and the nearest named junction. */
  junction: (SectionPlace & { ways: number | null }) | null;
  namedJunction: SectionPlace | null;
  /** The nearest petrol pump (15 km). */
  fuel: SectionPlace | null;
  /** The nearest road and railway km stones within 2 km, with the km they read (chainage). */
  kmRoad: (SectionPlace & { km: number | null }) | null;
  kmRail: (SectionPlace & { km: number | null }) | null;
  /** The nearest culvert. */
  culvert: SectionPlace | null;
  /** The runway of the nearest air site when recorded: size (`rw`) and direction (`rd`). */
  airRunway: string | null;
  air: SectionPlace | null;
  /** Road network density round the point (GroundGuideRoadDensity); null when off or the bundle has no network. */
  density: RoadDensityReading | null;
  /** What the NCGDB records on the nearest road (within 500 m), and its named route. */
  record: RoadRecord | null;
}

export interface RoadRecord {
  name: string | null;
  number: string | null;
  /** Load code as recorded: class, A / F (all- / fair-weather), lanes ("40A1"). */
  loadCode: string | null;
  widthM: number | null;
  /** Recorded condition, or null when none is recorded (about 4 % of roads have one). */
  condition: string | null;
  /** Seasonal / temporary closure as recorded, or null when none is recorded. */
  closed: string | null;
  landslides: number | null;
  defence: boolean;
  distanceM: number;
  compass: string;
  route: PlaceRoute | null;
}

export interface ObstacleHit {
  label: string;
  origin: 'natural' | 'man_made';
  /** What it means for the mode being placed (the profile's lists), null when it does not stop or slow it. */
  effect: 'NO-GO' | 'SLOW-GO' | null;
  distanceM: number;
  compass: string;
}

export interface ObstaclesReading {
  natural: ObstacleHit | null;
  manMade: ObstacleHit | null;
  /** Wet ground at the point (`wet` codebook), null when normal. */
  wet: string | null;
  canal: (SectionPlace & { widthM: number | null; depthM: number | null; bankM: number | null }) | null;
  reach: (SectionPlace & { bed: string | null; depthM: number | null; currentMs: number | null; dischargeCusecs: number | null; wetSpan: string | null }) | null;
  /** Aqueducts and siphons (where a canal crosses a drain or river) within the radius, and the nearest canal km stone. */
  canalWorks: SectionPlace[];
  canalKm: (SectionPlace & { km: number | null }) | null;
  /** A river, lake, canal or stream bank at the point (`bank` layer + rules.json `grotbc.banks`), within 30 / 75 / 150 m. */
  bank: { label: string; withinM: number } | null;
  dam: SectionPlace | null;
  /** The dam / barrage / headworks as recorded (river, length, height, gates, spans, load class), null when nothing is. */
  damDetail: string | null;
  levee: SectionPlace | null;
  /** A road nearby closed by season or with landslide sites, as recorded. */
  closure: { road: string; closed: string | null; landslides: number | null; distanceM: number; compass: string } | null;
  /** Power lines (with kV), pipelines and walls / fences within 2 km (OpenStreetMap), nearest first. */
  lines: Array<SectionPlace & { note: string | null }>;
}

export interface BuildingsReading {
  density: { code: number; label: string } | null;
  size: string | null;
  height: string | null;
  huts: { perKm2: number; temporary: boolean } | null;
  services: SectionPlace[];
  security: SectionPlace[];
  admin: PlaceAdmin | null;
  /** The country at the point as the NCGDB Countries layer names it ("Pakistan", "Afghanistan", "IIOJ&K"), null when not known. */
  country: string | null;
  sheet: PlaceSheet | null;
  border: PlaceBorder | null;
  /** `hq`: the seat of a province, district or tehsil (NCGDB Places, 2026-11-06), e.g. "tehsil HQ". */
  settlement: (SectionPlace & { sizeClass: string; people: number | null; hq: string | null }) | null;
  utilities: SectionPlace[];
  landmarks: SectionPlace[];
  /** Former "Data only" (added 2026-11-06): mines, mine shafts, kilns and chimneys (nearest of each, 5 km); the nearest
   *  deserted site, rest house / hotel (10 km), veterinary hospital (10 km) and boundary pillar (10 km). */
  industry: SectionPlace[];
  deserted: SectionPlace | null;
  lodging: SectionPlace | null;
  vet: SectionPlace | null;
  pillar: SectionPlace | null;
}

export interface WeatherReading {
  month: number;
  monthName: string;
  tmax: number | null;
  tmin: number | null;
  precMm: number;
  windMs: number | null;
  precYearMm: number | null;
  monsoonPct: number | null;
  frost: string[];
  hot: string[];
  wet: string[];
  source: string;
  dataDate: string;
  /** All twelve months (W3 year strip). */
  months: { tmax: Array<number | null>; tmin: Array<number | null>; prec: number[] };
}

export interface GroundGuideSections {
  style: SectionsStyle;
  /** The card style of each section (`auto` = follow `style`). */
  styles: SectionStyles;
  /** Road density on the card: the style and the lead band rule (from the options). */
  roadDensityStyle: RoadDensityStyle;
  roadDensityLead: RoadDensityLead;
  /** `sections.detail`: the detail grid under each one-line section. */
  detail: boolean;
  ground: GroundReading | null;
  roads: RoadsReading | null;
  buildings: BuildingsReading | null;
  weather: WeatherReading | null;
  obstacles: ObstaclesReading | null;
  /** A tile was still loading: the figures may change. */
  pending: boolean;
}

/** The features the sections read (GroundGuideFeatures, or null when the bundle has none). */
export interface SectionsFeatures {
  nearestOfKinds(at: MercXY, radiusM: number, keys: ReadonlySet<string>, max?: number, filter?: (h: FeatureHit) => boolean): { list: FeatureHit[]; pending: boolean };
  linesNear(at: MercXY, radiusM: number, keys: ReadonlySet<string>): { list: FeatureHit[]; pending: boolean };
  roadsNear(at: MercXY, radiusM: number): { list: FeatureRoadHit[]; pending: boolean };
}

export interface SectionsLayers {
  terrain: string | null;
  landform: string | null;
  elevHi: string | null;
  elevLo: string | null;
  route: string | null;
  bld: string | null;
  hut: string | null;
  /** cc (vegetation density of the area) and bank (river and canal banks), read by G and O since 2026-11-06. */
  cc: string | null;
  bank: string | null;
}

type Read = (layer: string, mx: number, my: number) => number | null | undefined;

function compassOf(deg: number): string {
  return COMPASS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function place(h: FeatureHit, label?: string): SectionPlace {
  const t = typeof h.attrs.t === 'string' && h.attrs.t.trim() ? h.attrs.t.trim() : null;
  return { label: label ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : h.kindLabel), name: h.name, distanceM: h.distanceM, compass: h.compass };
}

function elevAt(read: Read, L: SectionsLayers, x: number, y: number): number | null | undefined {
  if (!L.elevHi || !L.elevLo) return null;
  const hi = read(L.elevHi, x, y);
  const lo = read(L.elevLo, x, y);
  if (hi === undefined || lo === undefined) return undefined;
  if (hi === null || lo === null || hi === 255) return null;
  return hi * 256 + lo - 500;
}

/** Elevation `d` ground metres from the point along bearing `brg` (undefined while the tile loads). */
function elevAlong(a: SectionArgs, brg: number, d: number): number | null | undefined {
  const r = (brg * Math.PI) / 180;
  return elevAt(a.read, a.L, a.at[0] + (Math.sin(r) * d) / a.cosLat, a.at[1] + (Math.cos(r) * d) / a.cosLat);
}

const AXES = ['N–S', 'NNE–SSW', 'NE–SW', 'ENE–WSW', 'E–W', 'ESE–WNW', 'SE–NW', 'SSE–NNW'];
/** An axis (0-179 degrees from north) as "NE–SW". */
export function axisOf(deg: number): string {
  return AXES[Math.round((((deg % 180) + 180) % 180) / 22.5) % 8];
}

/** Ground roughness from the residual of a plane fitted to 5 x 5 elevations one pixel apart (m): proposal bands. */
const ROUGH: Array<[number, 0 | 1 | 2 | 3, string]> = [
  [1.0, 0, 'Smooth'],
  [2.5, 1, 'Uneven'],
  [5.0, 2, 'Broken'],
  [Infinity, 3, 'Very broken'],
];
const EYE_M = 2; // a man standing
const TAN3 = Math.tan((3 * Math.PI) / 180);

/**
 * Which way the slope faces: the 3 x 3 gradient over a ~90 m baseline (one pixel is DEM noise on gentle ground).
 * Null on level ground (under 2 degrees over the baseline).
 */
function aspectAt(a: SectionArgs, e0: number): { deg: number; compass: string } | null {
  const d = Math.max(a.pxM, 90);
  const [e, w, n, s] = [elevAlong(a, 90, d), elevAlong(a, 270, d), elevAlong(a, 0, d), elevAlong(a, 180, d)];
  if (![e, w, n, s].every((v) => typeof v === 'number')) return null;
  const gx = ((e as number) - (w as number)) / (2 * d);
  const gy = ((n as number) - (s as number)) / (2 * d);
  if (Math.atan(Math.hypot(gx, gy)) < (2 * Math.PI) / 180 || !Number.isFinite(e0)) return null;
  const deg = (((Math.atan2(-gx, -gy) * 180) / Math.PI) + 360) % 360;
  return { deg: Math.round(deg), compass: compassOf(deg) };
}

/** Roughness at the point: the 5 x 5 elevations one pixel apart less the plane through them (finest zoom only). */
function roughAt(a: SectionArgs): GroundReading['rough'] {
  if (a.zoom < a.maxZoom) return null;
  const d = a.pxM / a.cosLat;
  const z: number[] = [];
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const v = elevAt(a.read, a.L, a.at[0] + i * d, a.at[1] + j * d);
      if (typeof v !== 'number') return null;
      z.push(v);
    }
  }
  let m = 0;
  let bx = 0;
  let by = 0;
  for (let k = 0; k < 25; k++) {
    const i = (k % 5) - 2;
    const j = Math.floor(k / 5) - 2;
    m += z[k];
    bx += i * z[k];
    by += j * z[k];
  }
  m /= 25;
  bx /= 50; // sum of i² over the 5 x 5 grid
  by /= 50;
  let ss = 0;
  for (let k = 0; k < 25; k++) {
    const r = z[k] - m - bx * ((k % 5) - 2) - by * (Math.floor(k / 5) - 2);
    ss += r * r;
  }
  const res = Math.sqrt(ss / 25);
  const band = ROUGH.find(([lim]) => res < lim)!;
  return { level: band[1], label: band[2], residualM: Math.round(res * 10) / 10 };
}

/**
 * The military crest of the slope the point is on. Walk up the slope (against the way it faces) to the top, then
 * down a profile from the top to the foot (where the ground levels under 3 degrees for two steps); the military crest
 * is the highest profile point from which a man standing sees every point down to the foot. On level ground the point
 * may be a hill top: the steepest fall of 10 m or more within 150 m gives the slope to read.
 */
function militaryCrestAt(a: SectionArgs, e0: number, aspect: GroundReading['aspect']): MilitaryCrest | null {
  const step = Math.max(a.pxM, 30);
  let A = aspect?.deg ?? null;
  if (A === null) {
    let best: { brg: number; drop: number } | null = null;
    for (let i = 0; i < 8; i++) {
      const e = elevAlong(a, i * 45, 150);
      if (typeof e === 'number' && e0 - e >= 10 && (!best || e0 - e > best.drop)) best = { brg: i * 45, drop: e0 - e };
    }
    if (!best) return null;
    A = best.brg;
  }
  const up = (A + 180) % 360;
  // Up to the top: the highest sample before the ground falls 3 m below it (1.5 km at most).
  let topD = 0;
  let topE = e0;
  for (let d = step; d <= 1500; d += step) {
    const e = elevAlong(a, up, d);
    if (e === undefined) return null;
    if (e === null) break;
    if (e > topE) {
      topE = e;
      topD = d;
    } else if (e < topE - 3) break;
  }
  // The profile from the top (index 0) down through the point (index iP) to the foot (3 km below the point at most).
  const iP = Math.round(topD / step);
  const prof: number[] = [];
  let foot = -1;
  let gentle = 0;
  for (let k = 0; k * step <= topD + 3000; k++) {
    const dP = k * step - topD;
    const e = dP < 0 ? elevAlong(a, up, -dP) : elevAlong(a, A, dP);
    if (e === undefined) return null;
    if (e === null) break;
    prof.push(e);
    if (k > iP && k > 0) {
      gentle = prof[k - 1] - e < TAN3 * step ? gentle + 1 : 0;
      if (gentle >= 2) {
        foot = k - 2;
        break;
      }
    }
  }
  if (foot < 0) foot = prof.length - 1;
  if (foot <= iP || prof[0] - prof[foot] < 15) return null; // no real slope below the point
  // The highest observer that sees every point down to the foot.
  let m = foot;
  for (let i = 0; i < foot; i++) {
    const eye = prof[i] + EYE_M;
    let maxTan = -Infinity;
    let all = true;
    for (let j = i + 1; j <= foot; j++) {
      const t = (prof[j] - eye) / (j - i);
      if (t < maxTan - 1e-9) {
        all = false;
        break;
      }
      maxTan = Math.max(maxTan, t);
    }
    if (all) {
      m = i;
      break;
    }
  }
  const where: MilitaryCrest['where'] = Math.abs(m - iP) <= 1 ? 'on' : iP < m ? 'above' : 'below';
  return {
    where,
    distanceM: Math.abs(m - iP) * step,
    compass: compassOf(m > iP ? A : up),
    topDistanceM: topD,
    topCompass: compassOf(up),
    footDistanceM: (foot - iP) * step,
    dropM: Math.round(prof[0] - prof[foot]),
    faces: compassOf(A),
    profile: prof.slice(0, foot + 1).map((v) => Math.round(v)),
    stepM: step,
    iP,
    iM: m,
  };
}

function label(book: Record<string, unknown> | undefined, code: number | null | undefined, fallback: string): string {
  if (code === null || code === undefined) return fallback;
  const v = book?.[String(code)];
  return typeof v === 'string' ? v : `${fallback} ${code}`;
}

// ── G ────────────────────────────────────────────────────────────────────────
function readGround(a: SectionArgs): GroundReading {
  const { read, L, at, cosLat, books } = a;
  const tCode = L.terrain ? read(L.terrain, at[0], at[1]) : null;
  const terrain = tCode !== null && tCode !== undefined && tCode !== 255 && tCode > 0 ? { code: tCode, label: label(books.terrain, tCode, 'Terrain') } : null;

  // Nearest change of terrain type, along eight rays.
  let terrainChange: GroundReading['terrainChange'] = null;
  if (terrain && L.terrain) {
    const R = a.radiusM;
    const n = Math.min(40, Math.max(6, Math.ceil(R / Math.max(1, a.pxM))));
    for (let i = 0; i < 8; i++) {
      const b = (i * 45 * Math.PI) / 180;
      for (let k = 1; k <= n; k++) {
        const d = (k * R) / n;
        if (terrainChange && d >= terrainChange.distanceM) break;
        const v = read(L.terrain, at[0] + (Math.sin(b) * d) / cosLat, at[1] + (Math.cos(b) * d) / cosLat);
        if (v === undefined || v === null || v === 255 || v === 0) continue;
        if (v !== terrain.code) {
          terrainChange = { label: label(books.terrain, v, 'Terrain'), distanceM: d, compass: COMPASS8[i] };
          break;
        }
      }
    }
  }

  // Relief: elevation and slope from a 3 x 3 gradient one pixel apart.
  const e0 = elevAt(read, L, at[0], at[1]);
  let slopeDeg: number | null = null;
  if (e0 !== null && e0 !== undefined) {
    const d = a.pxM / cosLat; // one pixel, in Mercator metres
    const ex = [elevAt(read, L, at[0] + d, at[1]), elevAt(read, L, at[0] - d, at[1]), elevAt(read, L, at[0], at[1] + d), elevAt(read, L, at[0], at[1] - d)];
    if (ex.every((v) => typeof v === 'number')) {
      const [e, w, n, s] = ex as number[];
      const g = Math.hypot((e - w) / (2 * a.pxM), (n - s) / (2 * a.pxM));
      slopeDeg = (Math.atan(g) * 180) / Math.PI;
    }
  }
  const lf = L.landform ? read(L.landform, at[0], at[1]) : null;
  const landform = lf !== null && lf !== undefined && lf !== 255 && lf > 0 ? label(books.landform, lf, 'Landform') : null;

  // High ground: the highest feature with an elevation within the radius, above the point.
  const here = typeof e0 === 'number' ? e0 : null;
  let high: GroundReading['high'] = null;
  if (a.features) {
    const hits = a.features.nearestOfKinds(at, a.radiusM, KINDS.high, 400, (h) => typeof h.attrs.e === 'number');
    for (const h of hits.list) {
      const ev = h.attrs.e as number;
      if (here !== null && ev <= here + 5) continue;
      if (!high || ev > high.elevationM) high = { ...place(h), elevationM: ev, aboveM: here !== null ? Math.round(ev - here) : null };
    }
  }

  // The named area: the nearest named landform, hill range, desert, forest or region within 10 km.
  let area: SectionPlace | null = null;
  let water: SectionPlace[] = [];
  let namedWater: SectionPlace | null = null;
  if (a.features) {
    const hits = a.features.nearestOfKinds(at, 10000, KINDS.area, 1, (h) => {
      if (!h.name) return false;
      if (h.kind === 'landform_name' || h.kind === 'forest_name' || h.kind === 'glacier' || h.kind === 'vegetation_name') return true;
      const t = String(h.attrs.t ?? '').toLowerCase();
      return AREA_SUBTYPES.has(t);
    });
    if (hits.list[0]) area = place(hits.list[0]);

    // Water sources: the nearest of each kind (rules.json grotbc.water.kinds and wells, pumps, tanks), up to four.
    const wk = new Set<string>([...a.waterKinds, ...KINDS.waterExtra]);
    const seen = new Set<string>();
    for (const h of a.features.nearestOfKinds(at, a.radiusM, wk, 200).list) {
      if (seen.has(h.kind)) continue;
      seen.add(h.kind);
      water.push(place(h, h.kindLabel));
      if (water.length >= 4) break;
    }
    // The nearest named river, canal or stream (lines first, then named points).
    const lines = a.features.linesNear(at, a.radiusM, KINDS.waterLines).list.filter((h) => h.name);
    const pts = a.features.nearestOfKinds(at, a.radiusM, KINDS.waterNamed, 1, (h) => !!h.name).list;
    const best = [...lines.slice(0, 1), ...pts].sort((p, q) => p.distanceM - q.distanceM)[0];
    if (best) namedWater = place(best);
  }
  water = water.sort((p, q) => p.distanceM - q.distanceM);
  let ridge: GroundReading['ridge'] = null;
  if (a.features) {
    const r = a.features.linesNear(at, a.radiusM, KINDS.ridge).list[0];
    if (r) ridge = { crestM: num(r.attrs.e), lengthKm: num(r.attrs.lk), distanceM: r.distanceM, compass: r.compass };
  }

  // The ground class at the point and the nearest trees, water, riverbed and snow; the wet ground at and round it.
  const cls0 = read(a.clsLayer, at[0], at[1]);
  const info0 = typeof cls0 === 'number' && cls0 !== 255 ? a.classInfo(cls0) : null;
  const ccv = L.cc ? read(L.cc, at[0], at[1]) : null;
  const land = info0 ? { label: info0.label, vegetation: typeof ccv === 'number' && ccv !== 255 ? Math.min(3, ccv >> 4) : null } : null;
  const wet0 = a.wetLayer ? read(a.wetLayer, at[0], at[1]) : null;
  // 1-4 only: 5 (permanent water) is the Land and Lake rows, not wet ground.
  const wetHere = typeof wet0 === 'number' && wet0 > 0 && wet0 < 5 ? label(books.wet, wet0, 'Wet') : null;
  let trees: SectionPlace | null = null;
  let lakeC: SectionPlace | null = null;
  let riverbed: SectionPlace | null = null;
  let snow: SectionPlace | null = null;
  let wetNear: SectionPlace | null = null;
  {
    const R = Math.min(a.radiusM, 3000);
    const n = Math.min(30, Math.max(3, Math.ceil(R / Math.max(1, a.pxM))));
    const step = R / n;
    const here = info0?.name ?? '';
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const d = Math.hypot(i, j) * step;
        if (d === 0 || d > R) continue;
        const mx = at[0] + (i * step) / cosLat;
        const my = at[1] + (j * step) / cosLat;
        const brg = (Math.atan2(i, j) * 180) / Math.PI;
        const c = read(a.clsLayer, mx, my);
        if (typeof c === 'number' && c !== 255) {
          const inf = a.classInfo(c);
          if (inf) {
            const hit = (cur: SectionPlace | null, set: Set<string>) =>
              set.has(inf.name) && !set.has(here) && (!cur || d < cur.distanceM) ? { label: inf.label, name: null, distanceM: d, compass: compassOf(brg) } : cur;
            trees = hit(trees, TREE_CLASSES);
            lakeC = hit(lakeC, LAKE_CLASSES);
            riverbed = hit(riverbed, RIVERBED_CLASSES);
            snow = hit(snow, SNOW_CLASSES);
          }
        }
        if (!wetHere && a.wetLayer && (!wetNear || d < wetNear.distanceM)) {
          const w = read(a.wetLayer, mx, my);
          // 5 is permanent water: that is the lake row, not wet ground.
          if (typeof w === 'number' && w > 0 && w < 5) wetNear = { label: label(books.wet, w, 'Wet'), name: null, distanceM: d, compass: compassOf(brg) };
        }
      }
    }
  }
  // A named lake or reservoir (features) wins over unnamed water when it is not much further.
  let lake: SectionPlace | null = lakeC;
  if (a.features) {
    const lk = a.features.nearestOfKinds(at, Math.max(a.radiusM, 5000), KINDS.lake, 1).list[0];
    if (lk && (!lakeC || lk.distanceM <= (lakeC as SectionPlace).distanceM * 1.5 + 200)) lake = place(lk, lk.kindLabel);
  }

  const mh = a.features?.nearestOfKinds(at, 10000, KINDS.marsh, 1, (h) => !!h.name).list[0];
  const marsh = mh ? place(mh) : null;

  // DEM (2026-11-06): the way the slope faces, roughness, the military crest.
  const aspect = here !== null ? aspectAt(a, here) : null;
  const rough = here !== null ? roughAt(a) : null;
  const crest = here !== null ? militaryCrestAt(a, here, aspect) : null;

  // Dune fields, ground symbols and the sheet's notes (NCGDB Soil_Line / Soil_Point / Annotation_, 2026-11-06).
  let dunes: DuneField | null = null;
  let wind: GroundReading['wind'] = null;
  const groundSym: SectionPlace[] = [];
  const notes: GroundReading['notes'] = [];
  if (a.features) {
    const dh = a.features.nearestOfKinds(at, 3000, KINDS.dunes, 1).list[0];
    if (dh) {
      const or = num(dh.attrs.or);
      dunes = {
        spacingM: num(dh.attrs.sp),
        axis: or !== null && (num(dh.attrs.oc) ?? 0) >= 50 ? axisOf(or) : null,
        star: dh.attrs.t === 'star dunes',
        inField: dh.distanceM <= 1500,
        distanceM: dh.distanceM,
        compass: dh.compass,
      };
    }
    const seen = new Set<string>();
    for (const h of a.features.nearestOfKinds(at, Math.min(a.radiusM, 5000), KINDS.groundSym, 60).list) {
      if (seen.has(h.kind)) continue;
      seen.add(h.kind);
      groundSym.push(place(h, h.kindLabel));
      if (groundSym.length >= 3) break;
    }
    // Wind arrows: the axial mean of the nearest five (doubled angles, so 170 and 10 agree).
    const wa = a.features.nearestOfKinds(at, 25000, KINDS.wind, 5).list.filter((h) => typeof h.attrs.wd === 'number');
    if (wa.length) {
      let c2 = 0;
      let s2 = 0;
      for (const h of wa) {
        const r = ((h.attrs.wd as number) * Math.PI) / 90;
        c2 += Math.cos(r);
        s2 += Math.sin(r);
      }
      if (Math.hypot(c2, s2) / wa.length >= 0.5) {
        const deg = ((Math.atan2(s2, c2) * 90) / Math.PI + 180) % 180;
        wind = { axis: axisOf(deg), arrows: wa.length, distanceM: wa[0].distanceM, compass: wa[0].compass };
      }
    }
    const group: Record<string, 'going' | 'water' | 'vegetation' | 'ground'> = { note_going: 'going', note_water: 'water', note_vegetation: 'vegetation', note_ground: 'ground' };
    const seenN = new Set<string>();
    for (const h of a.features.nearestOfKinds(at, 2000, KINDS.notes, 60).list) {
      if (seenN.has(h.kind) || !h.name) continue;
      seenN.add(h.kind);
      notes.push({ ...place(h, h.kindLabel), group: group[h.kind] });
    }
  }

  return {
    aspect,
    rough,
    crest,
    dunes,
    wind,
    groundSym,
    notes,
    land,
    marsh,
    trees,
    lake,
    riverbed,
    snow,
    wetHere,
    wetNear,
    terrain,
    terrainChange,
    elevationM: here,
    slopeDeg: slopeDeg === null ? null : Math.round(slopeDeg * 10) / 10,
    slopeBand: slopeDeg === null ? null : slopeBand(slopeDeg),
    slopeApprox: a.zoom < a.maxZoom,
    landform,
    high,
    area,
    water,
    namedWater,
    ridge,
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function text(v: unknown): string | null {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim()).join(', ') || null;
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;
}

/** What the NCGDB records on the nearest road within 500 m (features `road` lines), with its named route. */
function roadRecord(a: SectionArgs): RoadRecord | null {
  if (!a.features) return null;
  const hit = a.features.roadsNear(a.at, 500).list[0];
  if (!hit) return null;
  const at = hit.attrs;
  const number = text(at.r);
  const name = text(at.n);
  const route = a.place?.route(number) ?? a.place?.route(name) ?? null;
  return {
    name,
    number,
    loadCode: text(at.c),
    widthM: num(at.w),
    condition: text(at.cn),
    closed: text(at.x),
    landslides: num(at.sl),
    defence: at.d === 1 || at.d === true,
    distanceM: hit.distanceM,
    compass: hit.compass,
    route,
  };
}

/**
 * The km stone to name: the nearest one whose reading (`n`, the km) is recorded, else the nearest. Many stones carry
 * no reading in the NCGDB; `km` is then null and the card says so.
 */
function kmStone(list: FeatureHit[], lbl: string): (SectionPlace & { km: number | null }) | null {
  const kmOf = (h: FeatureHit) => {
    const v = typeof h.attrs.n === 'number' ? h.attrs.n : typeof h.attrs.n === 'string' ? parseFloat(h.attrs.n) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const h = list.find((x) => kmOf(x) !== null) ?? list[0];
  return h ? { ...place(h, lbl), name: null, km: kmOf(h) } : null;
}

// ── R ────────────────────────────────────────────────────────────────────────
function routeCheck(profile: string, r: NonNullable<RoadsReading['route']>, rules: SectionArgs['rules']): RoadsReading['check'] {
  if (!r.on) return null;
  const t = rules?.tankable;
  const min = t?.minClass ?? 60;
  const lim = t?.limitedClass ?? 50;
  if (profile === 'tracked' && ROAD_TYPES.has(r.type)) {
    if (r.tier === 3) return { level: 'ok', text: `Tankable: class ${min} and over` };
    if (r.tier === 2) return { level: 'warn', text: `Class ${lim} to ${min - 1}: Al-Zarrar only, not Al-Khalid or T-80` };
    if (r.tier === 1) return { level: 'stop', text: `Below class ${lim}: not tankable` };
    return { level: 'unknown', text: 'Load class not recorded: treat as not tankable until checked' };
  }
  if (profile === 'tracked' && TRACK_TYPES.has(r.type)) return { level: 'unknown', text: 'Tr: no load class; check bridges and culverts' };
  if (profile === 'wheeled' || profile === 'roadbound' || profile === 'gun' || profile === 'ad' || profile === 'signals') {
    if (METALLED_TYPES.has(r.type)) return { level: 'ok', text: 'Metalled: all-weather' };
    if (TRACK_TYPES.has(r.type)) return { level: 'warn', text: 'Fair-weather surface: SLOW-GO after rain' };
  }
  if (profile === 'rail') return RAIL_TYPES.has(r.type) ? { level: 'ok', text: 'On a railway' } : { level: 'stop', text: 'Not a railway' };
  return null;
}

function readRoads(a: SectionArgs): RoadsReading {
  const { read, L, at, cosLat, books } = a;
  let route: RoadsReading['route'] = null;
  const decode = (v: number, d: number, brg: number) => {
    const type = v & 31;
    const tier = (v >> 5) & 3;
    return {
      on: d === 0,
      type,
      typeLabel: label(books.routeTypes, type, 'Route'),
      tier,
      tierLabel: label(books.routeTiers, tier, 'Tier'),
      msr: (v & 128) !== 0,
      distanceM: d,
      compass: compassOf(brg),
    };
  };
  if (L.route) {
    const v0 = read(L.route, at[0], at[1]);
    if (typeof v0 === 'number' && v0 !== 0 && v0 !== 255) route = decode(v0, 0, 0);
    else {
      // The nearest route within 500 m, one pixel at a time.
      const R = 500;
      const n = Math.min(15, Math.max(2, Math.ceil(R / Math.max(1, a.pxM))));
      const step = R / n;
      let best: { v: number; d: number; b: number } | null = null;
      for (let j = -n; j <= n; j++) {
        for (let i = -n; i <= n; i++) {
          const d = Math.hypot(i, j) * step;
          if (d === 0 || d > R || (best && d >= best.d)) continue;
          const v = read(L.route, at[0] + (i * step) / cosLat, at[1] + (j * step) / cosLat);
          if (typeof v !== 'number' || v === 0 || v === 255) continue;
          best = { v, d, b: (Math.atan2(i, j) * 180) / Math.PI };
        }
      }
      if (best) route = decode(best.v, best.d, best.b);
    }
  }
  let crossing: SectionPlace | null = null;
  let rail: SectionPlace | null = null;
  let air: SectionPlace | null = null;
  let airRunway: string | null = null;
  const railCrossings: RoadsReading['railCrossings'] = [];
  const transport: SectionPlace[] = [];
  // Rail bridges and level crossings are in the class layer only: the nearest of each within 2 km, one pass.
  {
    const R = Math.min(a.radiusM, 2000);
    const n = Math.min(30, Math.max(3, Math.ceil(R / Math.max(1, a.pxM))));
    const step = R / n;
    const best = new Map<string, SectionPlace & { note: string | null }>();
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const d = Math.hypot(i, j) * step;
        if (d > R) continue;
        const c = read(a.clsLayer, at[0] + (i * step) / cosLat, at[1] + (j * step) / cosLat);
        if (typeof c !== 'number' || c === 255) continue;
        const info = a.classInfo(c);
        if (!info || !RAIL_CROSSING_CLASSES.has(info.name)) continue;
        const prev = best.get(info.name);
        if (prev && prev.distanceM <= d) continue;
        const note = info.name === 'level_crossing' ? 'vehicles cross here' : 'trains and foot only';
        best.set(info.name, { label: info.label, name: null, distanceM: d, compass: compassOf((Math.atan2(i, j) * 180) / Math.PI), note });
      }
    }
    railCrossings.push(...best.values());
  }
  if (a.features) {
    const tn = a.features.nearestOfKinds(at, Math.max(a.radiusM, 10000), KINDS.railTunnel, 1).list[0];
    if (tn) railCrossings.push({ ...place(tn, tn.kindLabel), note: null });
    const seen = new Set<string>();
    for (const h of a.features.nearestOfKinds(at, Math.max(a.radiusM, 10000), KINDS.transport, 20).list) {
      if (seen.has(h.kind)) continue;
      seen.add(h.kind);
      transport.push(place(h, h.kindLabel));
    }
  }
  railCrossings.sort((p, q) => p.distanceM - q.distanceM);
  const chokepoints: SectionPlace[] = [];
  let junction: RoadsReading['junction'] = null;
  let namedJunction: SectionPlace | null = null;
  let fuel: SectionPlace | null = null;
  let kmRoad: RoadsReading['kmRoad'] = null;
  let kmRail: RoadsReading['kmRail'] = null;
  let culvert: SectionPlace | null = null;
  if (a.features) {
    for (const h of a.features.nearestOfKinds(at, 10000, KINDS.choke, 2, (x) => String(x.attrs.ig ?? '').includes('C')).list) chokepoints.push(place(h, h.kindLabel));
    const j = a.features.nearestOfKinds(at, 10000, KINDS.mainJunction, 1).list[0];
    if (j) junction = { ...place(j, 'Junction of main Rds'), ways: num(j.attrs.mx) };
    const nj = a.features.nearestOfKinds(at, Math.max(a.radiusM, 5000), KINDS.namedJunction, 1).list[0];
    if (nj) namedJunction = place(nj, nj.kindLabel);
    const fp = a.features.nearestOfKinds(at, 15000, KINDS.fuel, 1).list[0];
    if (fp) fuel = place(fp, fp.kindLabel);
    kmRoad = kmStone(a.features.nearestOfKinds(at, 2000, KINDS.kmRoad, 20).list, 'Rd km stone');
    kmRail = kmStone(a.features.nearestOfKinds(at, 2000, KINDS.kmRail, 20).list, 'Railway km stone');
    const cu = a.features.nearestOfKinds(at, a.radiusM, KINDS.culvert, 1).list[0];
    if (cu) culvert = { ...place(cu, cu.kindLabel), name: null };
  }
  if (a.features) {
    const c = a.features.nearestOfKinds(at, a.radiusM, KINDS.crossing, 1).list[0];
    if (c) crossing = place(c, c.kindLabel);
    const st = a.features.nearestOfKinds(at, Math.max(a.radiusM, 10000), KINDS.rail, 1).list[0];
    const ln = a.features.linesNear(at, a.radiusM, KINDS.railLines).list[0];
    const r = [st, ln].filter((x): x is FeatureHit => !!x).sort((p, q) => p.distanceM - q.distanceM)[0];
    if (r) rail = place(r, r.kindLabel);
    const ai = a.features.nearestOfKinds(at, Math.max(a.radiusM, 15000), KINDS.air, 1).list[0];
    if (ai) air = place(ai, ai.kindLabel);
    if (ai) airRunway = [text(ai.attrs.rw), text(ai.attrs.rd)].filter(Boolean).join(', ') || null;
  }
  // Road network density (R, Road Connectivity), from the routing network the T road line reads.
  let density: RoadDensityReading | null = null;
  if (a.roadNet && (a.opts.roadDensity || a.all)) {
    const res = a.roadNet.densityAround(at, Math.max(500, a.opts.roadDensityKm * 1000));
    density = roadDensityReading(res.totals, res.pending, a.rules?.roadDensity);
  }
  return { route, check: route ? routeCheck(a.profile, route, a.rules) : null, crossing, rail, railCrossings, transport, chokepoints, junction, namedJunction, fuel, kmRoad, kmRail, culvert, airRunway, air, density, record: roadRecord(a) };
}

// ── O ────────────────────────────────────────────────────────────────────────
function readObstacles(a: SectionArgs): ObstaclesReading {
  const { read, at, cosLat } = a;
  // The nearest natural and man-made obstacle class (the class's GROTBC letters carry O) within the radius.
  let natural: ObstacleHit | null = null;
  let manMade: ObstacleHit | null = null;
  const R = Math.min(a.radiusM, 2000);
  const n = Math.min(30, Math.max(3, Math.ceil(R / Math.max(1, a.pxM))));
  const step = R / n;
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const d = Math.hypot(i, j) * step;
      if (d > R) continue;
      const c = read(a.clsLayer, at[0] + (i * step) / cosLat, at[1] + (j * step) / cosLat);
      if (typeof c !== 'number' || c === 255) continue;
      const info = a.classInfo(c);
      // Crossings (bridges, fords) carry O too, but they are the way over an obstacle, not one.
      if (!info || !info.letters.includes('O') || info.kind === 'crossing') continue;
      const slot = info.origin === 'natural' ? natural : manMade;
      if (slot && slot.distanceM <= d) continue;
      const hit: ObstacleHit = { label: info.label, origin: info.origin, effect: a.effect(c), distanceM: d, compass: compassOf((Math.atan2(i, j) * 180) / Math.PI) };
      if (info.origin === 'natural') natural = hit;
      else manMade = hit;
    }
  }
  const wv = a.wetLayer ? read(a.wetLayer, at[0], at[1]) : null;
  const wet = typeof wv === 'number' && wv > 0 && wv !== 255 ? label(a.books.wet, wv, 'Wet') : null;

  let canal: ObstaclesReading['canal'] = null;
  let reach: ObstaclesReading['reach'] = null;
  let dam: SectionPlace | null = null;
  let damDetail: string | null = null;
  let levee: SectionPlace | null = null;
  const lines: ObstaclesReading['lines'] = [];
  if (a.features) {
    // Power lines, pipelines, walls and fences (OpenStreetMap, 2026-11-06): the nearest of each within 2 km.
    const seenL = new Set<string>();
    const near = [...a.features.linesNear(at, Math.min(a.radiusM, 2000), KINDS.osmLines).list].sort((p, q) => p.distanceM - q.distanceM);
    for (const h of near) {
      if (seenL.has(h.kind)) continue; // the nearest of each kind
      seenL.add(h.kind);
      const v = num(h.attrs.v);
      const t = text(h.attrs.t);
      const note = h.kind === 'power_line' ? (v ? `${v} kV` : t === 'minor line' ? 'minor line' : null) : h.kind === 'wall_fence' ? t : t ? `${t}` : null;
      lines.push({ ...place(h, h.kindLabel), note });
    }
    lines.sort((p, q) => p.distanceM - q.distanceM);
    const cl = a.features.linesNear(at, a.radiusM, KINDS.canalLines).list[0];
    if (cl) canal = { ...place(cl, cl.kindLabel), widthM: num(cl.attrs.w), depthM: num(cl.attrs.dp), bankM: num(cl.attrs.b) };
    const rc = a.features.nearestOfKinds(at, Math.max(a.radiusM, 10000), KINDS.reach, 1).list[0];
    if (rc) reach = { ...place(rc, 'River reach'), bed: text(rc.attrs.s), depthM: num(rc.attrs.dp) ?? num(rc.attrs.dm), currentMs: num(rc.attrs.cu), dischargeCusecs: num(rc.attrs.dc), wetSpan: text(rc.attrs.ws) };
    const dams = a.features.nearestOfKinds(at, Math.max(a.radiusM, 10000), KINDS.dam, 6).list;
    const dm = dams[0];
    if (dm) {
      // The structure as HeadWorks_Pakmap records it (2026-11-06): length, height, gates, spans, load class. The nearest
      // point may be a GeoNames copy without them: take them from a point of the same name within 2 km of it.
      const key = (h: FeatureHit) => (h.name ?? '').toLowerCase().replace(/\b(dam|barrage|headworks|head works|h\/w)\b/g, '').replace(/[^a-z]/g, '');
      const rec = (h: FeatureHit) => ['lm', 'hm', 'gt', 'sn', 'c', 'rv'].some((k) => h.attrs[k] !== undefined);
      const src = rec(dm) ? dm : dams.find((h) => rec(h) && h.distanceM <= dm.distanceM + 2000 && !!key(h) && key(h) === key(dm)) ?? dm;
      const lm = num(src.attrs.lm);
      const hm = num(src.attrs.hm);
      const gt = num(src.attrs.gt);
      const sn = num(src.attrs.sn);
      const parts = [
        text(src.attrs.rv) ? `on the ${text(src.attrs.rv)}` : null,
        lm ? `${Math.round(lm).toLocaleString('en-US')} m long` : null,
        hm ? `${hm} m high` : null,
        gt && gt <= 300 ? `${gt} gates` : null, // larger counts are recording errors
        sn && sn <= 300 ? `${sn} spans` : null,
        text(src.attrs.c) ? `class ${text(src.attrs.c)}` : null,
      ];
      dam = place(dm, dm.kindLabel);
      damDetail = parts.filter(Boolean).join(', ') || null;
    }
    const lv = a.features.nearestOfKinds(at, a.radiusM, KINDS.levee, 1).list[0];
    if (lv) levee = place(lv, lv.kindLabel);
  }
  // Roads nearby closed by season or with landslide sites (as recorded: "none recorded" is not "open").
  let closure: ObstaclesReading['closure'] = null;
  if (a.features) {
    for (const h of a.features.roadsNear(at, a.radiusM).list) {
      const x = text(h.attrs.x);
      const sl = num(h.attrs.sl);
      if (!x && !sl) continue;
      closure = { road: text(h.attrs.r) ?? text(h.attrs.n) ?? 'Rd', closed: x, landslides: sl, distanceM: h.distanceM, compass: h.compass };
      break;
    }
  }
  // A bank at the point: kind = value >> 2 (rules.json grotbc.banks.kinds), band = value & 3 (bandsM: 30, 75, 150 m).
  let bank: ObstaclesReading['bank'] = null;
  const bv = a.L.bank ? read(a.L.bank, at[0], at[1]) : null;
  if (typeof bv === 'number' && bv !== 0 && bv !== 255) {
    const kind = a.rules?.banks?.kinds?.[String(bv >> 2)];
    const within = a.rules?.banks?.bandsM?.[bv & 3] ?? [30, 75, 150][bv & 3];
    if (kind?.label && within) bank = { label: kind.label, withinM: within };
  }
  const canalWorks: SectionPlace[] = [];
  let canalKm: ObstaclesReading['canalKm'] = null;
  if (a.features) {
    const seen = new Set<string>();
    for (const h of a.features.nearestOfKinds(at, a.radiusM, KINDS.canalWorks, 20).list) {
      if (seen.has(h.kind)) continue;
      seen.add(h.kind);
      canalWorks.push({ ...place(h, h.kindLabel), name: h.name && h.name.toLowerCase() !== h.kind ? h.name : null });
    }
    canalKm = kmStone(a.features.nearestOfKinds(at, 2000, KINDS.kmCanal, 20).list, 'Canal km stone');
  }
  return { natural, manMade, wet, canal, reach, bank, canalWorks, canalKm, dam, damDetail, levee, closure, lines };
}

// ── B ────────────────────────────────────────────────────────────────────────
function readBuildings(a: SectionArgs): BuildingsReading {
  const { read, L, at, books } = a;
  const bv = L.bld ? read(L.bld, at[0], at[1]) : null;
  let density: BuildingsReading['density'] = null;
  let size: string | null = null;
  let height: string | null = null;
  if (typeof bv === 'number' && bv !== 255) {
    const dc = bv & 7;
    density = { code: dc, label: label(books.bldDensity, dc, 'Density') };
    const sc = (bv >> 3) & 7;
    if (sc > 0) size = label(books.bldSize, sc, 'Size');
    if (dc > 0) height = BLD_HEIGHT[bv >> 6] ?? null;
  }
  const hv = L.hut ? read(L.hut, at[0], at[1]) : null;
  const huts = typeof hv === 'number' && hv !== 255 ? { perKm2: hv & 127, temporary: (hv & 128) !== 0 } : null;
  const services: SectionPlace[] = [];
  const security: SectionPlace[] = [];
  if (a.features) {
    const R = Math.max(a.radiusM, 5000);
    for (const [keys, lbl] of [[KINDS.health, null], [KINDS.police, null], [KINDS.school, null], [KINDS.government, null]] as const) {
      const h = a.features.nearestOfKinds(at, R, keys, 1).list[0];
      if (h) services.push(place(h, lbl ?? h.kindLabel));
    }
    services.sort((p, q) => p.distanceM - q.distanceM);
    for (const h of a.features.nearestOfKinds(at, a.radiusM, KINDS.security, 2).list) security.push(place(h, h.kindLabel));
  }
  const utilities: SectionPlace[] = [];
  const landmarks: SectionPlace[] = [];
  let settlement: BuildingsReading['settlement'] = null;
  if (a.features) {
    const seen = new Set<string>();
    for (const h of a.features.nearestOfKinds(at, a.radiusM, KINDS.utilities, 60).list) {
      if (seen.has(h.kind)) continue;
      seen.add(h.kind);
      utilities.push(place(h, h.kindLabel));
      if (utilities.length >= 3) break;
    }
    // Protected sites first (no-strike / collateral), then the nearest other landmark.
    const lm = a.features.nearestOfKinds(at, a.radiusM, KINDS.landmarks, 80).list;
    const prot = lm.filter((h) => PROTECTED.has(h.kind));
    const other = lm.filter((h) => !PROTECTED.has(h.kind));
    for (const h of [...prot.slice(0, 2), ...other.slice(0, 1)]) landmarks.push(place(h, h.kindLabel));
    // The nearest named settlement and its size class (by people: WorldPop `wp`, else the official `p`).
    const st = a.features.nearestOfKinds(at, 15000, KINDS.places, 1, (h) => !!h.name).list[0];
    if (st) {
      // People: the larger of WorldPop's share (`wp`) and the official figure (`p`). A city, district HQ or town whose
      // figure says less than a town keeps its own kind rather than being called a hamlet (`wp` is only the people
      // nearest the point, so a hill town's can be small).
      const wp = num(st.attrs.wp);
      const p = num(st.attrs.p);
      const people = wp !== null || p !== null ? Math.max(wp ?? 0, p ?? 0) : null;
      const big = st.kind === 'city' || st.kind === 'district_hq' || st.kind === 'town';
      const cls = people !== null ? sizeClass(people) : st.kindLabel;
      const trust = people !== null && (!big || people >= 20_000);
      const hq = text(st.attrs.hq);
      settlement = { ...place(st, st.kindLabel), sizeClass: trust ? cls : st.kindLabel, people: trust ? people : null, hq: hq ? `${hq} HQ` : null };
    }
  }
  const industry: SectionPlace[] = [];
  let deserted: SectionPlace | null = null;
  let lodging: SectionPlace | null = null;
  let vet: SectionPlace | null = null;
  let pillar: SectionPlace | null = null;
  if (a.features) {
    const seen = new Set<string>();
    for (const h of a.features.nearestOfKinds(at, Math.max(a.radiusM, 5000), KINDS.industry, 80).list) {
      if (seen.has(h.kind)) continue;
      seen.add(h.kind);
      industry.push(place(h, h.kindLabel));
    }
    const ds = a.features.nearestOfKinds(at, a.radiusM, KINDS.deserted, 1).list[0];
    if (ds) deserted = place(ds, ds.kindLabel);
    const lg = a.features.nearestOfKinds(at, 10000, KINDS.lodging, 1).list[0];
    if (lg) lodging = place(lg);
    const vt = a.features.nearestOfKinds(at, 10000, KINDS.vet, 1).list[0];
    if (vt) vet = place(vt, vt.kindLabel);
    const bp = a.features.nearestOfKinds(at, 10000, KINDS.pillar, 1).list[0];
    if (bp) pillar = place(bp, bp.kindLabel);
    // A national park boundary (NCGDB Limit_Line 6, 2026-11-06) within 10 km: a protected area, named first.
    const pk = a.features.linesNear(at, 10000, KINDS.park).list[0];
    if (pk) landmarks.unshift(place(pk, pk.kindLabel));
  }
  const [lon, lat] = a.lonLat;
  // The admin layers also hold the neighbours' provinces (Hilmand, Kandahar ...), so the country is named beside them.
  const admin = a.place?.adminAt(lon, lat) ?? null;
  const country = a.place?.countryAt?.(lon, lat) ?? null;
  return {
    country,
    industry,
    deserted,
    lodging,
    vet,
    pillar,
    density,
    size,
    height,
    huts,
    services,
    security,
    admin,
    sheet: a.place?.sheetAt(lon, lat) ?? null,
    border: a.place?.borderNear(lon, lat) ?? null,
    settlement,
    utilities,
    landmarks,
  };
}

// ── W ────────────────────────────────────────────────────────────────────────
function readWeather(n: ClimateNormals, month: number): WeatherReading {
  const i = month - 1;
  const r1 = (v: number | null | undefined) => (typeof v === 'number' ? Math.round(v) : null);
  const pick = (pred: (k: number) => boolean) => MONTHS.filter((_, k) => pred(k));
  return {
    month,
    monthName: MONTHS[i],
    tmax: r1(n.tmax[i]),
    tmin: r1(n.tmin[i]),
    precMm: Math.round(n.prec[i]),
    windMs: typeof n.wind[i] === 'number' ? Math.round((n.wind[i] as number) * 10) / 10 : null,
    precYearMm: r1(n.precYear),
    monsoonPct: r1(n.monsoonPct),
    frost: pick((k) => typeof n.tmin[k] === 'number' && (n.tmin[k] as number) < n.thresholds.frostBelowC),
    hot: pick((k) => typeof n.tmax[k] === 'number' && (n.tmax[k] as number) >= n.thresholds.hotFromC),
    wet: pick((k) => n.prec[k] >= n.thresholds.wetFromMm),
    source: n.source,
    dataDate: n.dataDate,
    months: { tmax: n.tmax.map(r1), tmin: n.tmin.map(r1), prec: n.prec.map((v) => Math.round(v)) },
  };
}

export interface SectionArgs {
  opts: GroundGuideSectionsOptions;
  profile: string;
  at: MercXY;
  cosLat: number;
  /** Ground size of one pixel at the reading zoom, metres. */
  pxM: number;
  zoom: number;
  maxZoom: number;
  radiusM: number;
  L: SectionsLayers;
  read: Read;
  features: SectionsFeatures | null;
  books: {
    terrain?: Record<string, unknown>;
    landform?: Record<string, unknown>;
    routeTypes?: Record<string, unknown>;
    routeTiers?: Record<string, unknown>;
    bldDensity?: Record<string, unknown>;
    bldSize?: Record<string, unknown>;
    wet?: Record<string, unknown>;
  };
  rules: { tankable?: { minClass?: number; limitedClass?: number }; roadDensity?: RoadDensityRules; banks?: { bandsM?: number[]; kinds?: Record<string, { label?: string }> } } | null;
  /** The point as lon / lat (admin, sheet, border). */
  lonLat: [number, number];
  /** The class layer of the mode, and the class's label, origin and GROTBC letters (rules.json `classes`). */
  clsLayer: string;
  classInfo: (cls: number) => { name: string; label: string; origin: 'natural' | 'man_made'; letters: string; kind: string } | null;
  /** What a class means for the mode: the profile's NO-GO / SLOW-GO lists. */
  effect: (cls: number) => 'NO-GO' | 'SLOW-GO' | null;
  wetLayer: string | null;
  /** Admin areas, borders, sheets and named routes (GroundGuidePlaceData), or null. */
  place: {
    adminAt(lon: number, lat: number): PlaceAdmin | null;
    borderNear(lon: number, lat: number, maxKm?: number): PlaceBorder | null;
    sheetAt(lon: number, lat: number): PlaceSheet | null;
    countryAt?(lon: number, lat: number): string | null;
    route(numberOrName: string | null | undefined): PlaceRoute | null;
  } | null;
  /** The routing network for road density (GroundGuideRoads), or null when the bundle has none. */
  roadNet: { densityAround(at: MercXY, radiusM: number): { totals: RoadDensityTotals; pending: boolean } } | null;
  waterKinds: string[];
  climate: ClimateNormals | null;
  month: number;
  /** Read everything (the Brief is open) even when the card style shows less. */
  all: boolean;
  pending: () => boolean;
  featuresPending: () => boolean;
}

/** Read the sections the options ask for (all of them when the Brief is open). */
export function readSections(a: SectionArgs): GroundGuideSections {
  const o = a.opts;
  const ground = o.ground || a.all ? readGround(a) : null;
  const roads = o.roads || a.all ? readRoads(a) : null;
  const buildings = o.buildings || a.all ? readBuildings(a) : null;
  const weather = (o.weather || a.all) && a.climate ? readWeather(a.climate, a.month) : null;
  const obstacles = o.obstacles || a.all ? readObstacles(a) : null;
  return {
    style: o.style,
    styles: { g: o.gStyle ?? 'auto', r: o.rStyle ?? 'auto', o: o.oStyle ?? 'auto', b: o.bStyle ?? 'auto', w: o.wStyle ?? 'auto' },
    roadDensityStyle: o.roadDensityStyle,
    roadDensityLead: o.roadDensityLead,
    detail: o.detail !== false,
    ground,
    roads,
    buildings,
    weather,
    obstacles,
    pending: a.pending() || a.featuresPending() || !!roads?.density?.pending,
  };
}

/** Re-render key for the card. */
export function sectionsKey(s: GroundGuideSections | null | undefined): string {
  if (!s) return '';
  const g = s.ground;
  const r = s.roads;
  const b = s.buildings;
  const w = s.weather;
  const pl = (p: SectionPlace | null | undefined) => (p ? `${p.label}${p.name ?? ''}${Math.round(p.distanceM / 50)}${p.compass}` : '-');
  return [
    `${s.style}${s.detail ? 'd' : ''}`,
    `${s.styles.g}${s.styles.r}${s.styles.o}${s.styles.b}${s.styles.w}`,
    g ? `${g.terrain?.code ?? ''}${pl(g.terrainChange ? { label: g.terrainChange.label, name: null, distanceM: g.terrainChange.distanceM, compass: g.terrainChange.compass } : null)}${g.elevationM ?? ''}${Math.round(g.slopeDeg ?? -1)}${g.landform ?? ''}${pl(g.high)}${pl(g.area)}${g.water.map(pl).join('')}${pl(g.namedWater)}` : '',
    `${s.roadDensityStyle}${s.roadDensityLead}`,
    r ? `${r.route ? `${r.route.type}${r.route.tier}${r.route.msr ? 1 : 0}${Math.round(r.route.distanceM / 25)}` : '-'}${r.check?.level ?? ''}${pl(r.crossing)}${pl(r.rail)}${(r.railCrossings ?? []).map(pl).join('')}${(r.transport ?? []).map(pl).join('')}${pl(r.air)}${roadDensityKey(r.density)}` : '',
    b ? `${b.density?.code ?? ''}${b.size ?? ''}${b.height ?? ''}${b.huts ? `${b.huts.perKm2}${b.huts.temporary ? 't' : ''}` : ''}${b.services.map(pl).join('')}${b.security.map(pl).join('')}` : '',
    w ? `${w.month}${w.tmax}${w.precMm}` : '',
    g?.ridge ? `rg${Math.round(g.ridge.distanceM / 50)}` : '',
    g ? `${g.land?.label ?? ''}${g.land?.vegetation ?? ''}${pl(g.trees)}${pl(g.lake)}${pl(g.riverbed)}${pl(g.snow)}${g.wetHere ?? ''}${pl(g.wetNear)}` : '',
    r ? `${(r.chokepoints ?? []).map(pl).join('')}${pl(r.junction)}${pl(r.namedJunction)}${pl(r.fuel)}` : '',
    s.obstacles?.bank ? `bk${s.obstacles.bank.label}${s.obstacles.bank.withinM}` : '',
    `${pl(g?.marsh)}${pl(r?.kmRoad)}${pl(r?.kmRail)}${pl(r?.culvert)}${(s.obstacles?.canalWorks ?? []).map(pl).join('')}${pl(s.obstacles?.canalKm)}${(b?.industry ?? []).map(pl).join('')}${pl(b?.deserted)}${pl(b?.lodging)}${pl(b?.vet)}${pl(b?.pillar)}`,
    r?.record ? `rr${r.record.number ?? r.record.name ?? ''}${Math.round(r.record.distanceM / 50)}${r.record.route ? 'n' : ''}` : '',
    b ? `${b.admin?.tehsil ?? ''}${b.sheet?.s50k ?? ''}${b.border ? Math.round(b.border.distanceKm) : ''}${pl(b.settlement)}${b.utilities.map(pl).join('')}${b.landmarks.map(pl).join('')}` : '',
    s.obstacles ? `${s.obstacles.natural ? `${s.obstacles.natural.label}${Math.round(s.obstacles.natural.distanceM / 50)}` : '-'}${s.obstacles.manMade ? `${s.obstacles.manMade.label}${Math.round(s.obstacles.manMade.distanceM / 50)}` : '-'}${s.obstacles.wet ?? ''}${pl(s.obstacles.canal)}${pl(s.obstacles.reach)}${pl(s.obstacles.dam)}${pl(s.obstacles.levee)}${s.obstacles.closure ? `${s.obstacles.closure.road}${Math.round(s.obstacles.closure.distanceM / 50)}` : ''}` : '',
    s.pending ? 'p' : '',
  ].join('|');
}
