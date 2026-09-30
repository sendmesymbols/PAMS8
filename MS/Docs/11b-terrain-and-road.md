# 11b. Terrain, position and road-network engines

Reference for `DeadGroundMapper`, `KeyTerrainIdentificationEngine`, `LocalPeaksEngine`, `PosDefScorerEngine`, `OpRankerEngine`, `LandingZoneEngine`, `AirspaceEngine`, `RoadNetworkEngine` and `TrafficabilityEngine`. Registry, enabling and the shared lifecycle contract are in [11-analysis-engines.md](11-analysis-engines.md). Other groups: [11a](11a-los-wez-trajectory.md), [11c](11c-planning-ocoka-mission-deployment.md).

Related: [02 SymbolEngine API](02-symbol-engine-api.md) | [08 Settings](08-settings.md) | [09 Measurement, cues, MGRS](09-measurement-cues-mgrs.md) | [14 FAQ](14-faq-troubleshooting.md)

| Engine | Getter | Flag | Programmatic compute | Result type |
| --- | --- | --- | --- | --- |
| [DeadGroundMapper](#deadgroundmapper) | `deadGroundMapper` | `analysis.deadGround` | `runHeadless(options)` | `DeadGroundSummary` |
| [KeyTerrainIdentificationEngine](#keyterrainidentificationengine) | `keyTerrainIdentificationEngine` | `analysis.keyTerrain` | `runHeadless(options?)` | `KeyTerrainFeature[]` |
| [LocalPeaksEngine](#localpeaksengine) | `localPeaksEngine` | `analysis.localPeaks` | `runHeadless(options?)` | `LocalPeakResult[]` |
| [PosDefScorerEngine](#posdefscorerengine) | `posDefScorerEngine` | `analysis.positionDefensibility` | `scorePoint(point, options?)` | `DefensibilitySummary` |
| [OpRankerEngine](#opranker-engine) | `opRankerEngine` | `analysis.opRanker` | `rankCandidates(points, options?)` | `OpRankSummary` |
| [LandingZoneEngine](#landingzoneengine) | `landingZoneEngine` | `analysis.landingZone` | none | none |
| [AirspaceEngine](#airspaceengine) | `airspaceEngine` | `analysis.airspace` | none | none |
| [RoadNetworkEngine](#roadnetworkengine) | `roadNetworkEngine` | `features.roadNetwork` | `route`, `serviceArea` | `RoadResult<T>` |
| [TrafficabilityEngine](#trafficabilityengine) | `trafficabilityEngine` | created with the road engine | none | none |

For all headless methods: call them only after the engine exists (getter non-null); they need the engine's stored view and the map's `ground` elevation. Coordinates are WGS84 unless stated.

---

## DeadGroundMapper

Maps terrain hidden from an observer (dead ground) as a depth grid, with a heatmap (2D), mesh (3D), contours, spokes and an optional 3D viewshed dome. Module: `MS/Engines/Analysis/DeadGroundMapper.ts` (`export class DeadGroundMapper`, also default).

Layer ids: `MESH_LAYER_ID = 'dead-ground-mesh'`, `DOME_LAYER_ID = 'dead-ground-viewshed-dome'`, `DOME_HORIZON_LAYER_ID = 'dead-ground-viewshed-horizon'`, `CONTOUR_LAYER_ID = 'dead-ground-contours'`, `SPOKE_LAYER_ID = 'dead-ground-spokes'`, `OBSERVER_LAYER_ID = 'dead-ground-observer'`. The 2D heatmap is a `MediaLayer` added on demand.

### open(graphic: Graphic | undefined, view: MapView | SceneView): void

Shows the panel. A point or centroid graphic sets the observer (converted to WGS84); with no graphic and no existing observer, it starts a map pick. No re-edit path.

### runHeadless(options: DeadGroundHeadlessOptions): Promise<DeadGroundSummary>

| field of `options` | type | default | meaning |
| --- | --- | --- | --- |
| `observer` | `Point` | required | Observer location. |
| `observerHeightM` | `number` | `1.8` | Eye height above ground. |
| `radiusM` | `number` | `3000` | Analysis radius. |
| `cellM` | `number` | `100` | Grid cell size. |

Returns:

```ts
interface DeadGroundSummary {
  observer: Point;
  deadGroundPct: number;   // rounded integer percent of cells that are dead ground
  deadCount: number;
  totalCells: number;
  maxDepth: number;
  extent: Extent;
}
```

Throws `Error` if `initialize(view)` has not run. Observer ground elevation is queried with `view.map.ground.queryElevation`; if that fails the error is logged via `EngineLogger.error` and the observer height is used over 0 m. It draws nothing.

```ts
const summary = await symbolEngine.deadGroundMapper!.runHeadless({
  observer: new Point({ longitude: 74.35, latitude: 31.55, spatialReference: { wkid: 4326 } }),
  radiusM: 2000,
});
```

---

## KeyTerrainIdentificationEngine

Identifies tactically significant terrain (dominant ground, ridges, saddles, re-entrants, spurs) from a curvature/prominence analysis of a sampled DEM, ranks the features by a composite score and shows them in a list panel. Module: `MS/Engines/Analysis/KeyTerrain/KeyTerrainIdentificationEngine.ts`.

Layer ids: `MARKER_LAYER_ID = 'key-terrain-markers'`, `CENTER_LAYER_ID = 'key-terrain-center'`. Curvature and viewshed overlays are created on demand.

### open(graphic?: Graphic | null, view?: MapView | SceneView): void

Shows the control and list panels. A point or centroid graphic sets the analysis centre; otherwise the centre is cleared and a map pick starts. No re-edit.

### runHeadless(options?: KeyTerrainHeadlessOptions): Promise<KeyTerrainFeature[]>

| field of `options` | type | default | meaning |
| --- | --- | --- | --- |
| `center` | `Point \| { longitude: number; latitude: number }` | view centre | Analysis centre. |
| `extent` | `Extent` | square around `center` (radius plus 5 percent) | Sampling extent. |
| `radiusM` | `number` | `3500` | Analysis radius. |
| `cellM` | `number` | `80` | Grid cell size (grid is at least 12 by 12). |
| `maxFeatures` | `number` | `20` | Maximum features kept. |
| `sensitivity` | `number` | `5` | Detection sensitivity (scale not documented in source). |
| `wantHills` | `boolean` | `true` | Include dominant ground / ridges. |
| `wantSaddles` | `boolean` | `true` | Include saddles. |
| `wantReents` | `boolean` | `true` | Include re-entrants. |
| `wantSpurs` | `boolean` | `true` | Include spurs. |

Throws `Error` if not initialised. Each returned feature is a `RankedFeature` (alias `KeyTerrainFeature`):

```ts
type FeatureType = 'dominant_ground' | 'ridge' | 'saddle' | 're_entrant' | 'spur';

interface FeatureCandidate {
  r: number; c: number;          // grid row/column
  type: FeatureType;
  typeScore: number;
  elev: number;                  // metres
  prom: number;                  // prominence
  lap: number; plan: number; prof: number;   // Laplacian, plan and profile curvature
}
interface RankedFeature extends FeatureCandidate {
  lon: number; lat: number;
  viewshedRaw: number; viewshedPct: number; viewshedNorm: number;
  compositeScore: number;
  rank: number;
  depth?: number;
  ridgeBearing?: number;
  controlsRoute?: boolean;       // on the reachable road network
}
```

Road enrichment: after ranking, the method requests a drive-time service area from `window.symbolEngine.roadNetworkEngine` centred on the analysis centre. Dominant-ground, ridge, saddle and re-entrant features within 250 m of the returned road centrelines get `controlsRoute = true` and their `compositeScore` is multiplied by 1.15 (capped at 100, rounded). If any feature is boosted, the array is re-sorted by `compositeScore` (descending, in place) and `rank` is reassigned 1..n. If the adapter is absent, offline or lacks a service-area layer, no feature is changed.

---

## LocalPeaksEngine

Detects terrain peaks or valleys in an area of interest and ranks them by elevation and prominence. Module: `MS/Engines/Analysis/Peaks/LocalPeaksEngine.ts`.

Layer ids: `PEAK_LAYER_ID = 'local-peaks-results'`, `LABEL_LAYER_ID = 'local-peaks-labels'`, `AOI_LAYER_ID = 'local-peaks-aoi'`, `PROFILE_LAYER_ID = 'local-peaks-profile'`.

### open(graphic?: Graphic, view?: MapView | SceneView): void

Shows the panel. A point or centroid graphic switches the AOI mode to `buffer` and draws a buffer AOI around it (no analysis is run until the user starts it). With no graphic the AOI mode stays as last set (default panel value `extent`). Returns without action when no view is available.

### clearResults(): void

Public. Removes peak, label and profile graphics, empties the internal result list and resets the panel (status "Results cleared."). It is the only engine here with a public clear.

### runHeadless(options?: LocalPeaksHeadlessOptions): Promise<LocalPeakResult[]>

| field of `options` | type | default | meaning |
| --- | --- | --- | --- |
| `aoi` | `Polygon \| Extent` | current `view.extent` | Area of interest. For a polygon the analysis samples its bounding extent and candidates are filtered against the polygon. |
| `mode` | `'peaks' \| 'valleys'` | `'peaks'` | Detect maxima or minima. |
| `cellSizeM` | `number` | `90` | Grid cell size. |
| `searchRadiusM` | `number` | `240` | Neighbourhood radius. |
| `prominenceM` | `number` | `20` | Minimum prominence. |
| `isolationM` | `number` | `250` | Minimum isolation distance. |
| `minElevationM` | `number` | `-10000` | Elevation floor. |
| `maxResults` | `number` | `30` | Result cap. |
| `sortKey` | `'rank' \| 'elevation' \| 'prominence'` | `'rank'` | Sort order. |

Returns `LocalPeakResult[]` (empty array if the extent is unavailable). Throws if not initialised.

```ts
interface LocalPeakResult {
  id: number; rank: number;
  longitude: number; latitude: number;
  elevation: number; prominence: number;
  neighborhoodMean: number; neighborhoodMin: number; neighborhoodMax: number;
  isolationM: number;
  type: 'peaks' | 'valleys';
  row: number; col: number;
}
```

Note the panel defaults (cell 45 m, radius 180 m, prominence 25 m, isolation 300 m) differ from the headless defaults above.

---

## PosDefScorerEngine

Rates a position's defensive value across six factors, grades it and optionally draws overlays. Module: `MS/Engines/Analysis/PositionDefesibilityScorer/PosDefScorerEngine.ts` (the folder name is spelled `PositionDefesibilityScorer` in the source tree).

Layer ids: `OVERLAY_LAYER_ID = 'pos-def-viewshed-overlay'`, `SPOKES_LAYER_ID = 'pos-def-los-spokes'`, `POSITION_LAYER_ID = 'pos-def-position-marker'`, `EGRESS_LAYER_ID = 'pos-def-egress-routes'`, `HISTORY_LAYER_ID = 'pos-def-position-history'`.

### open(graphic: Graphic, view: MapView | SceneView): void

Shows the panels and scores the graphic's point/centroid immediately (async, fire-and-forget). Graphic is required.

### openWidget(view?: MapView | SceneView): void

Shows the panels without scoring. Does nothing if no view has been set. Subsequent map clicks score positions.

### get lastSummary(): DefensibilitySummary | null

The most recently scored position, or `null`.

### scorePoint(point: Point, options?: DefensibilityScoreOptions): Promise<DefensibilitySummary>

| field of `options` | type | default | meaning |
| --- | --- | --- | --- |
| `observerHeightM` | `number` | `1.8` | Eye height. |
| `obsRadius` | `number` | `2500` | Observation radius in metres. |
| `slopeRadius` | `number` | `150` | Slope sampling radius. |
| `rayResolutionDeg` | `number` | `10` | Angular ray step. |
| `threatBearingDeg` | `number` | `270` | Assumed threat bearing. |
| `maxSlopeDeg` | `number` | `12` | Slope considered passable. |
| `weights` | `Partial<Record<FactorId, number>>` | see below | Merged over the defaults. |

Default weights: `obs` 4, `fof` 4, `cff` 3, `cfv` 3, `egr` 3, `dg` 3. Factor ids (`FactorId`) with their panel labels: `obs` Observation arc, `fof` Fields of fire, `cff` Cover from fire, `cfv` Cover from view, `egr` Egress routes, `dg` Dead ground behind.

Returns:

```ts
interface DefensibilitySummary {
  point: Point;
  scores: Record<FactorId, number>;
  composite: number;
  grade: string;   // 'A+', 'A', 'B', 'B-', 'C', 'D', 'F'
  label: string;   // 'Exceptional', 'Strong', 'Good', 'Acceptable', 'Marginal', 'Poor', 'Indefensible'
}
```

Grade thresholds on `composite`: 85 A+, 75 A, 65 B, 55 B-, 45 C, 35 D, below F. This method does not draw overlays. `lastSummary` is assigned at one site (inside the interactive scoring path); `scorePoint` does not assign it. Elevation failure falls back to eye height over 0 m with a logged error. Egress scoring can use the road adapter when available; the headless call does not enable egress display.

---

## OpRanker engine

Class `OpRankerEngine` (heading anchor `#opranker-engine`). Ranks candidate observation posts by unique and total coverage, elevation advantage and mutual visibility, and proposes an optimal subset. Module: `MS/Engines/Analysis/OpRanker/OpRankerEngine.ts`.

Layer ids: `OP_LAYER_ID = 'op-ranker-markers'`, `RANGE_LAYER_ID = 'op-ranker-range-rings'`, `AO_LAYER_ID = 'op-ranker-ao-boundary'`, `AO_CENTER_LAYER_ID = 'op-ranker-ao-center'`, `MUTUAL_VIZ_LAYER_ID = 'op-ranker-mutual-viz'`.

### open(graphic: Graphic, view: MapView | SceneView): void

Opens the widget and, if no OPs exist yet, adds the graphic's point as the first candidate.

### openWidget(view?: MapView | SceneView): void

Shows the panels and binds map clicks to add candidates.

### get lastSummary(): OpRankSummary | null

Most recent ranking from either the panel or `rankCandidates`.

### rankCandidates(points: Point[], options?: OpRankHeadlessOptions): Promise<OpRankSummary>

| name / field | type | default | meaning |
| --- | --- | --- | --- |
| `points` | `Point[]` | required | Candidate OP positions. An empty array returns an empty summary. |
| `observerHeightM` | `number` | `1.8` | Eye height. |
| `maxRangeM` | `number` | `3500` | Viewshed range. |
| `aoRadiusM` | `number` | `3000` | Area-of-operations radius. |
| `cellM` | `number` | `120` | Raster cell size. |
| `optimalCount` | `number` | `min(3, points.length)` | Size of the optimal subset. |
| `aoCenterLon`, `aoCenterLat` | `number` | mean of `points` | AO centre (both must be set to take effect). |

```ts
interface OpRankSummary {
  candidates: Array<{
    point: Point; rank: number;
    uniquePct: number; totalPct: number;
    compositeScore: number;
    elevAdvM: number;
    mutualCount: number;      // always 0 from rankCandidates
    optimal: boolean;
  }>;
  combinedCoveragePct: number;
  gapPct: number;
  optimalIndices: number[];   // indices into the input `points`
}
```

`candidates` is sorted by `compositeScore` descending with `rank` starting at 1. Source comments state that the headless path uses neutral mutual-visibility (0) and road-access (0.35) inputs, so headless composite scores are not identical to the panel's. Elevation failures per candidate are counted and logged once. Road access is only used by the interactive panel (through `window.symbolEngine.roadNetworkEngine`).

---

## LandingZoneEngine

Assesses helicopter LZ/PZ/DZ suitability (slope, capacity, obstacles, approach corridors) either for a drawn polygon or by clicking a search point. Module: `MS/Engines/Analysis/LandingZone/LandingZoneEngine.ts`. Panel-only; no headless method.

Layer ids: `MARKER_LAYER_ID = 'lz-touchdown-markers'`, `CORRIDOR_LAYER_ID = 'lz-approach-corridors'`, `OBSTACLE_LAYER_ID = 'lz-obstacle-callouts'`, `ZONE_LAYER_ID = 'lz-zone-outline'`. Media layers are created for raster overlays and removed on `destroy()`.

### open(graphic: Graphic, view: MapView | SceneView): void

A polygon graphic (`geometry.type === 'polygon'` or has `rings`) switches to zone mode and scores its centroid. Any other graphic switches to search mode and arms a map pick.

### openWidget(view?: MapView | SceneView): void

Opens standalone, default search mode; arms a pick if there is no previous centre.

### close(): void / destroy(): void

Standard.

---

## AirspaceEngine

Authors restricted operations zones and airspace coordination areas (ROZ / ACA) with floor/ceiling bands and conflict detection between volumes. Module: `MS/Engines/Analysis/Airspace/AirspaceEngine.ts`. Panel-only.

Layer ids: `FOOTPRINT_LAYER_ID = 'airspace-footprints'`, `VOLUME_LAYER_ID = 'airspace-volumes-3d'`, `LABEL_LAYER_ID = 'airspace-labels'`, `CONFLICT_LAYER_ID = 'airspace-conflicts'`.

### open(graphic: Graphic, view: MapView | SceneView): void

Shows the panel. A polygon graphic is registered as an airspace volume, made active and rendered. Non-polygon graphics only open the panel.

### openWidget(view?: MapView | SceneView): void

Opens the panel so the user can draw a footprint (the engine owns a `SketchViewModel`).

### initialize(view)

Also drops and rebuilds the sketch for the new view and re-renders existing volumes, so volumes survive a 2D/3D switch. The 3D volume layer is only meaningful in a `SceneView`.

Auto-designations for new volumes come from `ALPHA`, `BRAVO`, `CHARLIE`, and so on (internal list of 12).

---

## RoadNetworkEngine

Adapter for an ArcGIS Server Network Analyst (NAServer) service. It provides road-following routes, drive-time service areas and per-road-class military trafficability. Module: `MS/Engines/Analysis/RoadNetworkEngine.ts` (`export default class RoadNetworkEngine`, plus named exports).

### Design contract (from the file header)

- The backend is optional and intermittent. **No method throws.** Every call resolves to `RoadResult<T>`: `{ ok: true; data: T }` or `{ ok: false; reason: RoadFailureReason; error: string; status?: number }`.
- Availability is probed lazily, cached for `availabilityTtlMs`, and de-duplicated.
- Callers should degrade to their own straight-line behaviour on `ok === false`.
- Everything it hands out is EPSG:4326.

Not in the analysis registry. `SymbolEngine` creates it only when `settingsData.features.roadNetwork === true`, initialises it with the current view, sets `window.roadNetworkEngine`, then probes. Only after a successful probe does it add the roads layer (unless `roadNetwork.showRoadsLayer === false`), create the `TrafficabilityEngine` and emit `roadNetworkEngineReady`. The default in `Settings.json` for `showRoadsLayer` is `false`. Access it with `symbolEngine.roadNetworkEngine` (may be `null`, and remains `null` if the feature flag is off at boot).

### constructor(config?: Partial<RoadNetworkConfig>)

Merged over `DEFAULT_ROAD_NETWORK_CONFIG`. Hosts can also construct their own instance and pass it to `TrafficabilityEngine.open(..., roadNet)`; note the other engines only discover the shared instance through `window.symbolEngine.roadNetworkEngine`.

### RoadNetworkConfig and defaults

| field | type | default (`DEFAULT_ROAD_NETWORK_CONFIG`) | meaning |
| --- | --- | --- | --- |
| `naServerUrl` | `string` | `/roadnet/arcgis/rest/services/RoadNetwork/NAServer` | NAServer base URL, no layer name. |
| `routeLayer` | `string` | `Route` | Route layer name; corrected from the probe. |
| `serviceAreaLayer` | `string` | `''` | Empty means auto-detect; none published means service areas are `unsupported`. |
| `roadsLayerUrl` | `string` | `/roadnet/arcgis/rest/services/RoadNetwork/MapServer` | Source roads service (display and class lookup). |
| `roadsSublayerId` | `number` | `11` | Routable roads sublayer. |
| `impedanceAttribute` | `string` | `Cost` | Cost attribute to minimise (travel time). |
| `impedanceUnits` | `'hours' \| 'minutes' \| 'seconds' \| 'kilometers' \| 'meters'` | `hours` | Units of the impedance attribute. |
| `distanceAttribute` | `string` | `Kilometers` | Accumulated distance attribute. |
| `classFieldName` | `string` | `CLAZZ` | Integer road-class field (osm2po). |
| `classifyRoutes` | `boolean` | `true` | Run the road-class enrichment query after each solve. |
| `classifySamples` | `number` | `120` | Max samples along a route. |
| `classifyToleranceM` | `number` | `25` | Sample to edge search radius. |
| `timeoutMs` | `number` | `30000` | Per-request timeout. |
| `availabilityTtlMs` | `number` | `30000` | Health result cache lifetime. |
| `healthRetries` | `number` | `1` | Retries for the health probe only (transient errors). |
| `enabled` | `boolean` | `true` | Master switch; `false` makes every call resolve `disabled`. |

`SymbolEngine` seeds these from `Settings.json` `roadNetwork.*` and forwards later `roadNetwork.*` setting changes through `updateConfig`. The shipped `Settings.json` also contains a `roadNetwork.serverUrl` key that the engine does not read (only `naServerUrl` and the fields above are passed).

Deployment note: the default `naServerUrl` is a **same-origin path**. In development `vite.config.ts` proxies `/roadnet` to the ArcGIS Server host and strips the prefix. A production host must supply an equivalent reverse proxy, or set `naServerUrl` to a directly reachable URL that has CORS enabled and a certificate the browser trusts.

### Status members

### get config(): Readonly<RoadNetworkConfig>
### get availability(): 'unknown' | 'available' | 'unavailable'
### get isAvailable(): boolean
### get lastHealth(): HealthData | null
### get supportsServiceArea(): boolean

`availability` is the last known state and may be stale. `supportsServiceArea` is true once the probe has found a Service Area layer (`serviceAreaLayer` non-empty).

```ts
interface HealthData { edges: number; name: string; routeLayer: string; serviceAreaLayer: string; } // edges is always 0
```

### updateConfig(patch: Partial<RoadNetworkConfig>): void

Merges the patch (undefined values are ignored). Changing `naServerUrl` or `enabled` invalidates the availability cache; disabling sets the state to `unavailable`.

### onStatusChange(listener: (state, info: HealthData | null) => void): () => void

Subscribes to availability transitions and returns an unsubscribe function. Listener exceptions are swallowed. The same transitions are also broadcast on `document` as a `CustomEvent` named `road-network:status` (exported constant `ROAD_NETWORK_STATUS_EVENT`), `bubbles: true`, `detail: { state, info }`.

### ensureAvailable(force = false): Promise<boolean>

Returns `true` when the service is (or has just been found) available. `false` when disabled. Uses the TTL cache unless `force`. Never throws.

### health(): Promise<RoadResult<HealthData>>

Probes the NAServer root (a GET on `naServerUrl`) which lists published route and service-area layers, retrying transient failures up to `healthRetries`. Updates state and config layer names. Fails with `unsupported` if no Route layer is published. (The file header calls this `/health`; the code probes the NAServer root.)

### route(from: PointLike, to: PointLike, opts?: RouteOptions): Promise<RoadResult<RouteData>>

Shortest-time route along roads.

| name | type | default | meaning |
| --- | --- | --- | --- |
| `from`, `to` | `PointLike` | required | `Point`, `Graphic`, `{ longitude, latitude }`, `{ x, y, spatialReference? }` or `[lng, lat]`. Unresolvable input gives `bad-input`. |
| `opts.barriers` | `RouteBarrier[]` | none | Polygon barriers passed to the solver. |

```ts
interface RouteData {
  distanceKm: number;
  travelTimeMin: number;
  byClass: { fclass: string; km: number }[];
  trafficability: TrafficabilitySummary;
  steps: { name: string; fclass: string; km: number; min: number }[];
  geometry: { type: 'LineString' | 'MultiLineString'; coordinates: number[][] | number[][][] };
}
interface RouteBarrier {
  rings: number[][][];            // lng/lat, outer ring first, closed
  name?: string;
  type?: 'restrict' | 'slow';     // default 'restrict'
  costFactor?: number;            // for 'slow'
}
```

A stop inside a `restrict` barrier cannot be routed; the solver reports no route rather than crossing the area (per the type documentation).

### serviceArea(origin: PointLike, minutes: number): Promise<RoadResult<ServiceAreaData>>

Drive-time isochrone as road centrelines. `minutes` must be a positive finite number (otherwise `bad-input`). Returns `unsupported` when the service publishes no Service Area layer. `ServiceAreaData` is `{ minutes: number; geometry: GeoJsonLineGeometry | null }`; `null` geometry (nothing reachable) is still `ok`.

### showRoadsLayer(): Promise<boolean> / hideRoadsLayer(): void

Adds or removes the reference roads layer (`MapImageLayer`, id `road-network-roads`, sublayer `roadsSublayerId`, opacity 0.7, hidden from the layer list). Best-effort; failures are logged, never thrown.

### drawRoute(from, to, opts?: DrawOptions): Promise<RoadResult<RouteData>>
### drawServiceArea(origin, minutes, opts?: DrawOptions): Promise<RoadResult<ServiceAreaData>>

Compute then render into the overlay layer (id `road-network-overlays`). `DrawOptions`: `clearPrevious` (default `true`), `color` (`[r,g,b]` or `[r,g,b,a]`; defaults to blue for routes, purple for service areas), `width` (default 4 for routes, 1.6 for service areas), `markers` (default `true`), `barriers` (routes only). Rendering happens only on success.

### clearOverlays(): void

Empties the overlay layer.

### initialize(view) / onViewChanged(view) / destroy()

`initialize` only stores the view and does **not** probe. `onViewChanged` moves the roads and overlay layers to the new map. `destroy` hides layers, clears overlays, removes listeners.

### Static helpers

| Signature | Purpose |
| --- | --- |
| `static classifyClass(fclass: string): RoadClassInfo` | Trafficability for an OSM road class; unknown classes fall back to `DEFAULT_ROAD_CLASS_INFO` (SLOW-GO, route type Z). |
| `static classifyRoute(byClass: RouteClassBreakdown[]): TrafficabilitySummary` | Summarises per-class distances; rating is the worst tier present. |
| `static toPolyline(geometry): Polyline \| null` | GeoJSON line to ArcGIS `Polyline` (WGS84). |
| `static toRouteGraphic(data: RouteData, symbol?): Graphic \| null` | Ready-to-add graphic with attributes `roadnet`, `distance_km`, `travel_time_min`. |
| `static circleBarrier(lng, lat, radiusKm, opts?): RouteBarrier` | Geodesic circle as barrier rings; `opts.sides` defaults to 48, plus optional `name`, `type`, `costFactor`. |

Named exports: `ROAD_NETWORK_STATUS_EVENT`, `ROAD_CLASS_INFO`, `DEFAULT_ROAD_CLASS_INFO`, `OSM2PO_CLAZZ_TO_FCLASS`, `DEFAULT_ROAD_NETWORK_CONFIG` and the types `RoadNetworkAvailability`, `RoadFailureReason`, `RoadResult`, `PointLike`, `RouteStep`, `RouteClassBreakdown`, `Trafficability`, `RoadClassInfo`, `TrafficabilityClassBreakdown`, `TrafficabilitySummary`, `RouteData`, `ServiceAreaData`, `RouteBarrier`, `RouteOptions`, `HealthData`, `RoadNetworkConfig`, `DrawOptions`.

Failure reasons (`RoadFailureReason`): `disabled`, `unavailable`, `unsupported`, `timeout`, `network`, `bad-request`, `no-route`, `server`, `parse`, `bad-input`. A `network`, `timeout` or `server` failure on an operation marks the service unavailable and forces a fresh probe next time.

Trafficability tiers (`Trafficability`): `'GO' | 'SLOW-GO' | 'NO-GO'`. Class mapping (from `ROAD_CLASS_INFO`): motorway/trunk and links and primary are GO; secondary, tertiary, unclassified, residential, service are SLOW-GO; track and path are NO-GO. Route type hints are X (all-weather), Y (limited), Z (fair-weather).

```ts
const rn = symbolEngine.roadNetworkEngine;
if (rn && await rn.ensureAvailable()) {
  const res = await rn.route([74.35, 31.55], [74.45, 31.62]);
  if (res.ok) {
    console.log(res.data.distanceKm, res.data.trafficability.rating);
  } else {
    console.warn(res.reason, res.error);   // fall back to straight-line
  }
}
```

### Offline behaviour

When the service is down, disabled, or lacks a layer, `route`/`serviceArea` resolve with `ok: false` and never throw. All consumers in this suite handle that: Corridor keeps straight-line geometry; Trafficability draws geodesic range rings (service area) or great-circle legs (route/MSR) and marks estimated values with `*`; OCOKA, Key Terrain, OP Ranker, PosDef and Mission Planner skip enrichment. Toggling `features.roadNetwork` at runtime re-probes (`ensureAvailable(true)`); switching it off keeps the instance, sets `enabled: false`, hides the roads layer, closes Trafficability and unlinks its context-menu entry.

2D vs 3D: no view-type branches; results are plain geometry.

---

## TrafficabilityEngine

The trafficability, reachability and route-planning widget. Three modes share one panel: service-area isochrones, road-following routes, and main-supply-route (MSR) chains across waypoints, with callouts and a drive playback scrubber. Module: `MS/Engines/Analysis/TrafficabilityEngine.ts` (`export class TrafficabilityEngine`, also default). Not in the registry: `SymbolEngine` creates it after a successful road-network probe (and only when `features.roadNetwork` is true), links it into the context menu, sets `window.trafficabilityEngine` and emits `trafficabilityEngineReady`.

Layer ids: `ANALYSIS_LAYER_ID = 'trafficability-analysis'`, `MARKER_LAYER_ID = 'trafficability-markers'`, `COMMITTED_LAYER_ID = 'trafficability-committed'`.

### Exported type

```ts
type ReachMode = 'serviceArea' | 'route' | 'msr';
```

### open(graphic?: Graphic | null, view?: MapView | SceneView, roadNet?: RoadNetworkEngine): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic \| null` | `undefined` | Its point/centroid becomes the origin. Without it the user picks an origin on the map. |
| `view` | `MapView \| SceneView` | `undefined` | Calls `initialize(view)` when given. |
| `roadNet` | `RoadNetworkEngine` | `undefined` | Use this adapter instead of `symbolEngine.roadNetworkEngine`. It is remembered for later opens. |

`open()` resets working state (stops playback, clears callouts and graphics, clears destination and waypoints), subscribes to road status changes for the panel's status badge, and refreshes the badge.

### onViewChanged(view: MapView | SceneView): void

Moves the three layers and the callout host to the new view's map. Called by `SymbolEngine.onViewChanged` (not through the registry).

### close(): void / destroy(): void

`close()` hides the panel, stops playback, clears graphics, callouts and state and unsubscribes from road status. `destroy()` also removes the layers and panels.

Offline: with the road service down, it falls back to geodesic range rings (assumed speed times minutes) for service areas and great-circle legs with speed-based ETA for routes and MSRs; estimated values are flagged with an asterisk. The badge updates through `RoadNetworkEngine.onStatusChange`, without polling.

```ts
const se = (window as any).symbolEngine;
se.trafficabilityEngine?.open(graphic ?? undefined, se.view);
```
