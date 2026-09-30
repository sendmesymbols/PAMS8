# 11c. OCOKA, Mission Planner and Deployment Builder

Reference for `OcokaEngine`, `MissionPlannerEngine` and `DeploymentBuilderEngine`. Registry, enabling and the shared lifecycle contract are in [11-analysis-engines.md](11-analysis-engines.md). Other groups: [11a](11a-los-wez-trajectory.md), [11b](11b-terrain-and-road.md).

Related: [02 SymbolEngine API](02-symbol-engine-api.md) | [07 Import and export](07-import-export.md) | [08 Settings](08-settings.md) | [14 FAQ](14-faq-troubleshooting.md)

| Engine | Getter | Flag | Registered in registry | Programmatic compute |
| --- | --- | --- | --- | --- |
| [OcokaEngine](#ocokaengine) | `ocokaEngine` | `analysis.ocoka` | yes | `runHeadless(options?)` returns `OcokaCorridor[]` |
| [MissionPlannerEngine](#missionplannerengine) | `missionPlannerEngine` | `analysis.missionPlanner` | yes | `runHeadless(options?)` returns `MissionTerrainFeature[]` |
| [DeploymentBuilderEngine](#deploymentbuilderengine) | none; `window.deploymentBuilderEngine` | `features.deploymentBuilder` | no (singleton) | none |

---

## OcokaEngine

OCOKA (Obstacles, Cover and concealment, Observation and fields of fire, Key terrain, Avenues of approach) terrain analysis. The engine extracts candidate approach corridors inside a circular area, scores each on six factors and ranks them. Background on the framework and the two panels ("OCOKA Config" and the "Avenues of Approach" ranking list) is in the repository file `docs/OCOKA.md`.

Module: `MS/Engines/OCOKA/Ocoka.ts` (`export class OcokaEngine`, also default). Registered key `ocoka`; registry log name `OCOKAEngine`.

Layer ids: `CORRIDOR_LAYER_ID = 'ocoka-corridors'`, `WIDTH_LAYER_ID = 'ocoka-widths'`, `CHOKE_LAYER_ID = 'ocoka-chokepoints'`, `LABEL_LAYER_ID = 'ocoka-labels'`, `AO_LAYER_ID = 'ocoka-ao'`, `HEAT_LAYER_ID = 'ocoka-slope-heatmap'`. They are separate from symbol layers, so clearing or destroying OCOKA does not affect military symbols.

### open(graphic?: Graphic | null, view?: MapView | SceneView): void

Shows the config and list panels and binds map clicks.

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic \| null` | `undefined` | A point or centroid sets the analysis centre (lat/lon inputs and analysis-area ring). |
| `view` | `MapView \| SceneView` | `undefined` | Calls `initialize(view)` when given. |

With no graphic and no previously chosen centre, the panel prompts the user to click the map. When a centre is set from a graphic, the analysis-area ring uses the radius selector value, falling back to 5000 m if it cannot be read. `open()` also adds the CSS class `ms-popup-dark` to `document.body`; `close()` removes it. No re-edit path.

### runHeadless(options?: OcokaHeadlessOptions): Promise<OcokaCorridor[]>

Runs the corridor extraction without a panel and without drawing.

| field of `options` | type | default | meaning |
| --- | --- | --- | --- |
| `center` | `OcokaPoint \| Point` | view centre | Analysis centre. |
| `radiusM` | `number` | `5000` | Analysis radius. |
| `cellM` | `number` | `100` | Grid cell size. |
| `maxCorridors` | `number` | `7` | Maximum corridors. |
| `slopeThresholdDeg` | `number` | slope for `force` | Slope treated as impassable. |
| `force` | `ForceType` | `'wheeled'` | Trafficability standard. |
| `weights` | `Partial<OcokaWeights>` | see below | Merged over the defaults. |

`ForceType` is `'dismount' | 'wheeled' | 'tracked' | 'mixed'`. Default slope thresholds by force: dismount 35 degrees, wheeled 12, tracked 20, mixed 15.

`OcokaWeights` fields and headless defaults: `width` 3, `mask` 4, `traf` 3, `obs` 4, `cc` 3, `obs2` 3.

Returns corridors sorted by `composite` descending with `rank` assigned from 1. Throws `Error` if `initialize(view)` has not been called.

```ts
interface OcokaPoint { longitude: number; latitude: number; elevationM?: number }

interface OcokaCorridor {
  id: string;
  rank: number;
  seed: OcokaPoint;
  path: OcokaPoint[];
  chokePts: OcokaPoint[];
  widthM: number;
  lengthM: number;
  bearingDeg: number;
  composite: number;                 // 0..100 (bands below)
  scores: { width: number; mask: number; traf: number; obs: number; cc: number; obst: number };
  note: string;
  viaRoad?: boolean;                 // centreline replaced by a real road route
  roadDistanceKm?: number;           // only when viaRoad
  roadTimeMin?: number;              // only when viaRoad
  trafficability?: TrafficabilitySummary | null;   // only when viaRoad
}
```

The `weights` key `obs2` and the score field `obst` refer to the obstacle factor (naming mismatch in the source; the mapping is inferred from the two names).

Display bands used by the panel for `composite`: 80 and above "Primary avenue", 60 to 79 "Secondary avenue", 40 to 59 "Restricted", below 40 "Unlikely". Threat labels: 75 and above high, 45 and above medium, otherwise low.

Elevation and offline behaviour:

- The engine builds an elevation sampler over the area with `noDataValue: NaN` and rejects non-finite samples. Where no DEM sample is available it falls back to a synthetic terrain surface (`pseudoTerrain`), and this is documented in each corridor's `note`. Results computed on the synthetic surface are not real terrain analysis; a host that cannot guarantee elevation should surface `note` to users.
- Road enrichment: after extraction, `runHeadless` tries to replace each corridor centreline with a real road route from its perimeter entry to the centre, and re-derives the trafficability score from the road classes traversed. It reaches the road adapter through `window.symbolEngine.roadNetworkEngine`. It is a no-op if that is absent or down; one failed route leaves that corridor unchanged. See [11b RoadNetworkEngine](11b-terrain-and-road.md#roadnetworkengine).

```ts
const corridors = await symbolEngine.ocokaEngine!.runHeadless({
  center: { longitude: 74.35, latitude: 31.55 },
  radiusM: 4000,
  force: 'tracked',
});
console.log(corridors[0].rank, corridors[0].composite, corridors[0].viaRoad ?? false);
```

### close(): void / destroy(): void

Standard; `destroy()` also removes the six layers, both panels, hint, legend and tooltip.

---

## MissionPlannerEngine

Unified tactical terrain dashboard. It orchestrates Local Peaks, Key Terrain, Dead Ground, Position Defensibility, OP Ranker and OCOKA to rank candidate positions for a mission mode and unit type, and adds observer management, hostile-observation exposure, fires and sectors, a movement route (withdraw, exfil, advance or MSR), COA snapshots and a printable report.

Module: `MS/Engines/MissionPlanner/MissionPlannerEngine.ts` (`export class MissionPlannerEngine`, also default). Registered key `missionPlanner`. Design notes are in `MS/Engines/MissionPlanner/dashboardplan.md`.

Layer ids: `FEATURE_LAYER_ID = 'mission-planner-ranked-features'`, `AO_LAYER_ID = 'mission-planner-ao'`, `OBSERVER_LAYER_ID = 'mission-planner-observers'`, `CORRIDOR_LAYER_ID = 'mission-planner-corridor-influence'`, `LABEL_LAYER_ID = 'mission-planner-labels'`, `SNAPSHOT_LAYER_ID = 'mission-planner-report-snapshot'`, `FIRES_LAYER_ID = 'mission-planner-fires'`, `HOSTILE_OBS_LAYER_ID = 'mission-planner-hostile-obs'`, `WITHDRAWAL_LAYER_ID = 'mission-planner-withdrawal'`.

Sub-engine ownership: the planner creates its **own** private instances of `LocalPeaksEngine`, `KeyTerrainIdentificationEngine`, `DeadGroundMapper`, `PosDefScorerEngine`, `OpRankerEngine` and `OcokaEngine`. Its `initialize()` assigns the view to them directly (it does not call their `initialize`), so they never register layers and are used only for their headless methods. Consequences: disabling `analysis.ocoka` (or any other single engine flag) does not disable that capability inside the planner, and the standalone instances in the registry are unaffected by the planner.

### Exported types

```ts
type MissionMode = 'defensive' | 'offensive' | 'recon' | 'route' | 'ambush';
type UnitType = 'infantry' | 'mechanized' | 'aviation';
type ObserverSide = 'friendly' | 'enemy';

interface MissionCaution { level: 'info' | 'warn' | 'danger'; text: string }

interface MissionTerrainFeature {
  id: number; rank: number;
  type: string; name: string;
  point: Point;
  mgrs: string;
  elevationM: number; prominenceM: number; elevationAdvantageM: number;
  viewshedPct: number; deadGroundPct: number;
  defensibilityScore: number;
  mobilityInfluenceScore: number; corridorControlScore: number;
  ambushScore: number;
  exposureToEnemyPct: number;
  marchTimeMin: number;
  bearingToThreatDeg: number;
  elevationProfile: number[];        // sparkline samples toward the threat
  compositeScore: number;
  recommendedUse: string;
  cautions: MissionCaution[];
}

interface MissionPlannerHeadlessOptions {
  aoi?: Polygon | Extent;
  center?: Point;
  radiusM?: number;
  mode?: MissionMode;
  unit?: UnitType;
  threatBearingDeg?: number;
  observers?: { side: ObserverSide; point: Point }[];
  maxResults?: number;
}
```

### initialize(view: MapView | SceneView): void

Adds the nine layers and wires the view into the sub-engines (see above). Idempotent for the same view. `onViewChanged(view)` just calls `initialize(view)`; the registry calls `onViewChanged` for this engine on a 2D/3D switch.

### open(graphic?: Graphic, view?: MapView | SceneView): void

Shows the dashboard. A point or centroid graphic is added as a friendly observer ("Selected position") and becomes the buffer-AOI centre. Without a graphic the panel waits for the user to pick a mode and unit and run over the current view. Returns without action when no view is available.

### openWidget(view?: MapView | SceneView): void

Same as `open(undefined, view)`.

### close(): void / destroy(): void

`close()` hides the panel and cancels picks, auto-run and sketching. `destroy()` also clears results, removes the layers and destroys the six private sub-engines.

### runAnalysis(): Promise<void>

Runs the same analysis as the panel's Run button using the panel's current AOI, mode and unit. Returns immediately (without effect) if there is no view or a run is already in progress. Results are rendered on the map and in the panel; the method resolves to `void`, so read results through `runHeadless` instead if you need data.

### runHeadless(options?: MissionPlannerHeadlessOptions): Promise<MissionTerrainFeature[]>

| field of `options` | type | default | meaning |
| --- | --- | --- | --- |
| `aoi` | `Polygon \| Extent` | current `view.extent` | Area of interest. |
| `center` | `Point` | AOI centre, else view centre | Centre used by the peaks, key-terrain and OCOKA passes. |
| `radiusM` | `number` | `3500` | Radius for key-terrain, hostile-observation and scoring (OCOKA uses `max(radiusM, 4500)`). |
| `mode` | `MissionMode` | `'defensive'` | Selects scoring weights (table below). |
| `unit` | `UnitType` | `'infantry'` | Selects max slope, OCOKA force and speed (table below). |
| `threatBearingDeg` | `number` | derived from enemy observers | Threat direction. When no active enemy observer exists the fallback reads the panel's `mp-threat-bearing` input (a DOM value; 0 if the panel has not been built). |
| `observers` | `{ side, point }[]` | none | When provided, **replaces** the engine's observer list before the run. |
| `maxResults` | `number` | `8` | Number of candidates scored and returned. |

Returns features sorted by `compositeScore` descending, with `rank` and `id` reassigned 1..n. Throws `Error` if the engine has not been initialised. Returns `[]` if no AOI can be determined. Internally it runs `LocalPeaksEngine.runHeadless` (12 results, 300 m cells, 15 m prominence), `KeyTerrainIdentificationEngine.runHeadless` (14 features, 200 m cells), `OcokaEngine.runHeadless` (150 m cells, force from the unit table), then scores merged candidates against a shared elevation sampler. `ambush` mode blends the final score: `round(0.6 * ambushScore + 0.4 * compositeScore)`. The run stores its results and OCOKA corridors on the instance (visible to `generateReport`); `runHeadless` does not open the panel. Whether the hostile-observation step draws graphics in headless mode was not audited.

Scoring weights per mode (`MODE_WEIGHTS`; each row sums to 1.00):

| Mode | terrain | observation | defensibility | corridor | concealment | accessibility |
| --- | --- | --- | --- | --- | --- | --- |
| `defensive` | 0.25 | 0.25 | 0.20 | 0.15 | 0.10 | 0.05 |
| `offensive` | 0.18 | 0.20 | 0.10 | 0.20 | 0.25 | 0.07 |
| `recon` | 0.18 | 0.32 | 0.15 | 0.08 | 0.20 | 0.07 |
| `route` | 0.12 | 0.15 | 0.08 | 0.32 | 0.18 | 0.15 |
| `ambush` | 0.15 | 0.10 | 0.15 | 0.30 | 0.25 | 0.05 |

Unit settings (`UNIT_SETTINGS`):

| Unit | maxSlopeDeg | OCOKA force | defaultSpeedKmh |
| --- | --- | --- | --- |
| `infantry` | 35 | `dismount` | 5 |
| `mechanized` | 20 | `tracked` | 25 |
| `aviation` | 90 | `mixed` | 180 |

Movement route per mode: `defensive` withdraw, `ambush` exfil, `recon` exfil, `offensive` advance, `route` MSR. When the road service is up, the panel adds a road-following egress with drive time and a trafficability rating; otherwise it falls back to terrain corridors.

```ts
const mp = symbolEngine.missionPlannerEngine!;
const features = await mp.runHeadless({
  center: view.center as Point,
  radiusM: 3000,
  mode: 'defensive',
  unit: 'mechanized',
  observers: [{ side: 'enemy', point: enemyPoint }],
});
```

### clearResults(updateUi = true): void

Removes all planner graphics and clears results, corridors, hostile-observation extents, the run sampler and the road egress. `updateUi = false` skips panel re-rendering (used internally during `runAnalysis` and `destroy`). It does not clear the observer list.

### generateReport(): string

Returns an HTML string ("Mission Planner Terrain Report") with the top 12 ranked features (rank, name, MGRS, score, viewshed, dead ground, exposure), a COA comparison table when COA snapshots exist, and commander notes. It reads the mode, unit and threat bearing from the panel controls, so if the panel has never been built those values fall back to `defensive`, `infantry` and the derived bearing. Feature `name` and other values are interpolated into the HTML without escaping; treat it as trusted output of your own analysis and sanitise before injecting into a page that also renders user content.

### pinObserverFromGraphic(graphic: Graphic, side: ObserverSide): void

Adds the graphic's point/centroid as an observer on the given side, opens the panel on the "observation" tab and marks it active. Used by the context menu's "pin from map" provider; hosts may call it directly.

Offline and 2D/3D: needs ground elevation for all sub-analyses; uses the optional road adapter (via `window.symbolEngine.roadNetworkEngine`) only for road egress and never constructs one. The intervisibility model is bare-earth terrain only (observer and target height 2 m each); it ignores vegetation and structures. Score-scaled 3D markers and elevated labels are used in a `SceneView`, with a 2D fallback, per `dashboardplan.md`; view-type branching is limited in the source (3 occurrences of a 3D check).

---

## DeploymentBuilderEngine

Places pre-built tactical plans (groups of symbols) onto the map at a chosen anchor point and bearing, in a selectable formation, using a picker widget. Module: `MS/Engines/DeploymentBuilder/DeploymentBuilderEngine.ts`. It is a **singleton** and is loaded by dynamic import from `SymbolEngine` when `features.deploymentBuilder === true`; it is not part of the analysis registry.

How to obtain it:

```ts
const dbe = (window as any).deploymentBuilderEngine;   // set by SymbolEngine
dbe?.openWidget();
// or listen for the event on the view container:
view.container.addEventListener('deploymentBuilderEngineReady', (e) => {
  const engine = (e as CustomEvent).detail.engine;
});
```

`SymbolEngine` has no public getter for it (the field is private). The default export is the class; use `DeploymentBuilderEngine.getInstance()` if you import it yourself.

Runtime toggle: `symbolEngine.onSettingChanged(['features','deploymentBuilder'], value)` builds it on first enable, and otherwise calls `enable()` or `disable()` on the existing instance.

### static getInstance(): DeploymentBuilderEngine

Returns the singleton, creating it on first use. The constructor is private.

### start(view: MapView | SceneView, serialEngine: SerializationEngine): void

| name | type | meaning |
| --- | --- | --- |
| `view` | `MapView \| SceneView` | Active view. A hidden `GraphicsLayer` (`listMode: 'hide'`) is added for ghost previews. |
| `serialEngine` | `SerializationEngine` | Used at placement time via `loadPlanSymbolsFromData`. `SymbolEngine` passes its own `serializationEngine`. |

It also resolves the registry base URL (see below). Calling `start` twice adds a second ghost layer without removing the first; `SymbolEngine` calls it once.

### onViewChanged(view: MapView | SceneView): void

Cancels placement, replaces the ghost layer on the new map and removes pointer handles. Called by `SymbolEngine.onViewChanged`.

### enable(): void / disable(): void

`enable()` sets an internal flag. `disable()` clears it, cancels any placement in progress and removes the background popup. In the source reviewed, the flag is not consulted by other members, so `enable()` has no other visible effect and `openWidget()` still works while disabled. Treat these two methods as low-impact.

### openWidget(): void

Builds the "Deployment Mgr" widget on first call (element id `deploymentBuilderWidget`) or shows and restores it, then (re)loads the plan registry into the list. Takes no arguments; the view was set by `start`.

### destroy(): void

Disables, removes the widget and ghost layer, and clears the singleton (the next `getInstance()` builds a new instance).

### Workflow (widget)

1. Pick a plan from the categorised list (search box filters by name and category), or click "Use Saved Plan..." to load a local Save Plan JSON file.
2. Choose a formation and spacing (collapsed disclosure; defaults are As-Is and 0 m).
3. Click "Place on Map", click the map to set the anchor, then (for non-As-Is formations) move the cursor and click again to set the bearing. As-Is skips the bearing step. Right-click during the bearing phase returns to anchor picking; Esc cancels.
4. On commit the engine calls `serializationEngine.loadPlanSymbolsFromData(plan)`; the widget closes when at least one symbol was placed, and stays open with an "Empty" state when none were.

Formations (`FORMATIONS` keys): `as-is`, `line`, `column`, `wedge`, `echelonR`, `echelonL`, `vee`. Each formation table defines five slot offsets (lateral, forward), scaled by the spacing; how plans with more than five symbols are distributed was not audited. Imported files must pass `Plan.isPlanDocument` and contain at least one placeable symbol, otherwise the status line reports an error.

`loadPlanSymbolsFromData` (in `SerializationEngine`) returns the number of loaded symbols, or `-1` when the engine is not initialised or the document is invalid. See [07 Import and export](07-import-export.md).

### Plan registry and hosting requirements

The registry base URL is hard-coded: `_resolveRegistryBase()` returns `'/MS/Data/Deployments/'`. The engine fetches:

- `/MS/Data/Deployments/Deployemets.json` (the filename is spelled this way in the source and on disk),
- each plan file listed there, relative to the same base.

A host that ships only the minified build must serve these files from that URL path. There is no option to change the base URL.

Registry file shape:

```json
{
  "plans": [
    { "id": "own-attack-1", "name": "Attack Plan", "category": "own",
      "file": "Plans/Own/AttackPlan.json", "description": "Maneuver attack with combined arms" }
  ]
}
```

`category` groups plans in the list. Known labels: `own` Own Forces, `en` Enemy, `attack` Attack, `defence` Defence, `logistic` Logistic, `exercises` Exercises, `imported` Imported, `other` Other; any other value is shown with its first letter capitalised. `file` may use relative segments; the shipped registry references some exercise plans as `../../../../Templates/Ex/<name>.json`, so those template files must also be reachable at the resolved URL.

Offline / failure behaviour: if the registry request fails, the engine logs `Failed to load plan registry` through `EngineLogger.error` and shows "No plans available". A failed plan file logs an error and yields `null` (nothing is placed). The registry result is cached in memory for the life of the instance. No external service is involved, and 2D and 3D use the same code path.
