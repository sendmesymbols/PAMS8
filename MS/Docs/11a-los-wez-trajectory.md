# 11a. Fires, line of sight, route and flight engines

Reference for `LOSEngine`, `WeaponEffectEngine`, `TrajectoryEngine`, `BufferEngine`, `EffectEngine`, `CorridorEngine`, `FlightEngine` and the intervisibility helper. Registry, enabling and the shared lifecycle contract are in [11-analysis-engines.md](11-analysis-engines.md). Other groups: [11b](11b-terrain-and-road.md), [11c](11c-planning-ocoka-mission-deployment.md).

Related: [02 SymbolEngine API](02-symbol-engine-api.md) | [08 Settings](08-settings.md) | [14 FAQ](14-faq-troubleshooting.md)

All engines here are panel-driven. Their public methods are the lifecycle set (`initialize`, `open`, `close`, `destroy`). None has a headless compute method. Parameters such as range, azimuth, weapon type or altitude are edited in the panel; the source provides no setter for them. Instances come from the `SymbolEngine` getters and are `null` when disabled.

| Engine | Getter | Settings flag | Needs symbol to open | Re-edit committed | External services |
| --- | --- | --- | --- | --- | --- |
| [LOSEngine](#losengine) | `losEngine` | `analysis.los` | no | `los_viewshed` | elevation |
| [WeaponEffectEngine](#weaponeffectengine) | `weaponEffectEngine` | `analysis.wez` | no | `wez_zone` | elevation (terrain mask, 3D) |
| [TrajectoryEngine](#trajectoryengine) | `trajectoryEngine` | `analysis.trajectory` | no | `trajectory_arc` | elevation |
| [BufferEngine](#bufferengine) | `bufferEngine` | `analysis.buffer` | no | no | none verified |
| [EffectEngine](#effectengine) | `effectEngine` | `analysis.effects` | no | no | none |
| [CorridorEngine](#corridorengine) | `corridorEngine` | `analysis.corridor` | yes | `corridor_zone` | road network (optional) |
| [FlightEngine](#flightengine) | `flightEngine` | `analysis.flight` | yes | `flight_plan` | none verified |
| [Intervisibility](#intervisibility) | `SymbolEngine.showIntervisibility()` | none | no | no | elevation |

Every `open()` first calls `initialize(view)` when a view is passed, so `open(graphic, view)` is safe on a freshly constructed engine.

---

## LOSEngine

Line-of-sight and viewshed analysis from an observer point. In 2D it ray-casts against an elevation sampler. In 3D it also hands the problem to ArcGIS native LOS / viewshed analyses (per the file header).

Module: `MS/Engines/Analysis/LOSEngine.ts` (`export class LOSEngine`, also default export).

Layer ids: `LOSEngine.ANALYSIS_LAYER_ID = 'los-analysis'`, `OBSERVER_LAYER_ID = 'los-observer'`, `COMMITTED_LAYER_ID = 'los-committed'`. All three layers use `elevationInfo.mode = 'absolute-height'`.

### constructor()

No arguments. Creates the three layers. Normally you do not construct it; use `symbolEngine.losEngine`.

### initialize(view: MapView | SceneView): void

Adds the layers to `view.map`. In a `SceneView` it also re-adds any committed native LOS/viewshed analyses to `view.analyses`, and clears working LOS analyses.

### open(graphic: Graphic | undefined, view: MapView | SceneView): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic \| undefined` | none (required positional) | Seeds the observer from a point geometry or a centroid. `undefined` opens the panel and arms a map pick for the observer. |
| `view` | `MapView \| SceneView` | none (required) | View to analyse in. |

Notes:

- Passing a committed graphic with `attributes.type === 'los_viewshed'` and `attributes.committedAt != null` re-opens it. The panel is restored from `observerLon`, `observerLat`, `obsHeight`, `maxRange`, `azStart`, `azEnd`, `elevMin`, `elevMax`, `outputType`, `colorBy`, `analysisMode`, `nativeInteractive`.
- Every other call starts fresh: previous observer, targets and working graphics are cleared.

### close(): void / destroy(): void

`close()` hides the panel and clears working graphics, targets and pending picks; committed graphics are kept. `destroy()` also clears committed native analyses and removes the layers and panel.

Example (from `src/main.ts`):

```ts
const se = (window as any).symbolEngine;
se.losEngine?.open(getActiveGraphic() ?? undefined, se.view);
```

Graphic attribute types written by the engine: `los_observer`, `los_target` (with `index`), `los_obstruction`, `los_ring`, `los_viewshed`.

2D vs 3D: native LOS/viewshed dome only in `SceneView`; sampler ray casting in both. Offline: needs the ArcGIS ground elevation service; failure handling was not audited.

---

## WeaponEffectEngine

Weapon Effect Zone (WEZ): a range/azimuth sector around a firing point with a minimum-range dead zone, maximum-range ring, and (in 3D) an optional terrain-masked sector. Module: `MS/Engines/Analysis/WeaponEffectEngine.ts`.

Layer ids: `WeaponEffectEngine.ANALYSIS_LAYER_ID = 'wez-analysis'`, `COMMITTED_LAYER_ID = 'wez-committed'`, `OBSERVER_LAYER_ID = 'wez-observer'`.

### initialize(view: MapView | SceneView): void

Adds the three layers to the map.

### open(graphic?: Graphic | null, view?: MapView | SceneView): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic \| null \| undefined` | `undefined` | Seeds the firing point. With no symbol the panel opens and the user places the point by clicking the map or entering Lat/Lon. |
| `view` | `MapView \| SceneView \| undefined` | `undefined` | Calls `initialize(view)` when given. |

Notes:

- Re-edit: `attributes.type === 'wez_zone'` with `committedAt`. Restored keys: `observerLon`, `observerLat`, `minRangeM`, `maxRangeM`, `azimuthCenterDeg`, `azimuthSpreadDeg`, `elevMaxDeg`, `fillOpacity`, `weaponType` (default `'mortar'`).
- Resume: if the panel was hidden with an observer set, `open()` simply shows it again.
- Weapon detection from the symbol reads `attributes.sidc` / `attributes.SIDC` (substring `ANTI_AIR` or `AA` selects `anti_air`) and `attributes.graphicType` / `attributes.weaponType` (substrings `mortar`, `artillery`, `atgm`, `anti_air`, `anti_armor`, `direct`); the default is `mortar`. The `AA` substring test is loose and can match unrelated SIDC strings.

### close(): void / destroy(): void

As in the shared contract.

### Exports

`WEAPON_PRESETS: Record<string, WeaponPreset>` with keys `direct_fire`, `mortar`, `artillery`, `atgm`, `anti_air`, `anti_armor`. `WeaponPreset` has `label`, `minRangeM`, `maxRangeM`, `azimuthSpreadDeg`, `elevMinDeg`, `elevMaxDeg`, `extrudeHeightFactor`, `color: [number, number, number]`, `accentHex`, `icon`.

| Key | Label | minRangeM | maxRangeM |
| --- | --- | --- | --- |
| `direct_fire` | Direct Fire | 50 | 3000 |
| `mortar` | Mortar | 70 | 5600 |
| `artillery` | Artillery 155mm | 3000 | 30000 |
| `atgm` | ATGM | 75 | 5500 |
| `anti_air` | Anti-Air | 200 | 8000 |
| `anti_armor` | Anti-Armor | 100 | 4000 |

Graphic attribute types: `wez_zone`, `wez_dead_zone`, `wez_ring`, `wez_label`, `wez_az_line`, `wez_observer`, `wez_masked_sector`.

2D vs 3D: 3D uses extruded/mesh symbols and shows a "terrain mask" control; 2D draws flat fills. `wez-engine.d.ts` in the same folder describes an older JavaScript engine and is not the current class.

---

## TrajectoryEngine

Ballistic projectile trajectory from a fire point to a target with launch angle, muzzle velocity, wind and optional Coriolis and CEP. Module: `MS/Engines/Analysis/TrajectoryEngine.ts`.

Layer ids: `ANALYSIS_LAYER_ID = 'trajectory-analysis'`, `OBSERVER_LAYER_ID = 'trajectory-observer'`, `COMMITTED_LAYER_ID = 'trajectory-committed'`.

### initialize(view: MapView | SceneView): void

Adds the layers to the map.

### open(graphic?: Graphic | null, view?: MapView | SceneView): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic \| null \| undefined` | `undefined` | Fire point seed. With a symbol the engine then waits for the user to click a target; without one it first waits for the fire point. |
| `view` | `MapView \| SceneView \| undefined` | `undefined` | Calls `initialize(view)` when given. |

Notes:

- Re-edit: `attributes.type === 'trajectory_arc'` with `committedAt`. Restored keys: `fireLon`, `fireLat`, `fireZ`, `targetLon`, `targetLat`, `targetZ`, `launchAngle`, `muzzleVel`, `azimuth`, `windSpeed`, `windBearing`, `usePhases`, `showCEP`, `useCoriolis`, `presetKey` (default `'mortar_81mm'`).
- Preset auto-detection from the symbol looks for `mortar`, `artillery`, `atgm`, `rpg`, `drone`/`uav` in `attributes.sidc`/`SIDC` and `attributes.graphicType`/`type`, otherwise `mortar_81mm`.

### Exports

`PROJECTILE_PRESETS: Record<string, ProjectilePreset>`. `ProjectilePreset` fields: `label`, `massKg`, `diamM`, `Cd`, `muzzleVelocity`, `optimalAngle`, `maxAngle`, `cepM`, `color`, `accentHex`, `icon`.

| Key | Label | muzzleVelocity (m/s) | cepM |
| --- | --- | --- | --- |
| `mortar_60mm` | Mortar 60 mm | 250 | 30 |
| `mortar_81mm` | Mortar 81 mm | 293 | 35 |
| `mortar_120mm` | Mortar 120 mm | 320 | 40 |
| `artillery_105` | Artillery 105 mm | 472 | 50 |
| `artillery_155` | Artillery 155 mm | 827 | 70 |
| `atgm` | ATGM | 185 | 1 |
| `rpg7` | RPG-7 | 115 | 12 |
| `drone_loiter` | Loitering munition | 50 | 3 |
| `baktar_shikan` | Baktar Shikan ATGM (PK) | 160 | 2 |
| `nasr_srbm` | NASR Hatf-IX SRBM (PK) | 760 | 150 |
| `grad_bm21` | BM-21 Grad 122 mm (PK) | 690 | 160 |
| `fatah1_mlrs` | Fatah-1 MLRS 250 mm (PK) | 980 | 100 |
| `nag_atgm` | Nag ATGM (IN) | 230 | 1 |
| `pinaka_mk1` | Pinaka Mk-I 214 mm (IN) | 820 | 100 |
| `bofors_fh77` | Bofors FH-77B 155 mm (IN) | 864 | 45 |
| `prahaar_srbm` | Prahaar SRBM (IN) | 1150 | 80 |

Graphic attribute types: `trajectory_fire`, `trajectory_target`, `trajectory_apogee`, `trajectory_impact`, `trajectory_cep` (with `cepM`), `trajectory_projectile`, and the committed `trajectory_arc`.

---

## BufferEngine

Buffer zones and concentric threat rings around one or more sources; supports single, union and corridor analysis modes (internal `AnalysisMode`). Module: `MS/Engines/Analysis/BufferEngine.ts`.

Layer ids: `ANALYSIS_LAYER_ID = 'buffer-analysis'`, `LABEL_LAYER_ID = 'buffer-labels'`, `SOURCE_LAYER_ID = 'buffer-sources'`, `COMMITTED_LAYER_ID = 'buffer-committed'`.

### open(graphic?: Graphic | null, view?: MapView | SceneView): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic \| null \| undefined` | `undefined` | Adds the symbol's point (converted to WGS84) as a source. In `single` mode it replaces the source list; in other modes it appends. With no sources the engine arms a map pick. |
| `view` | `MapView \| SceneView \| undefined` | `undefined` | Calls `initialize(view)` when given. |

There is no re-edit path for committed buffers.

### Exports

`THREAT_PRESETS` keys: `artillery_155mm`, `mortar_81mm`, `atgm`, `ied_vbied`, `nbc_release`, `observation_post`, `custom`. Each preset has `label` and `rings: ThreatRingDef[]`. Example: `mortar_81mm` has rings "Max range" 5600 m, "Effective range" 3200 m, "Danger close" 200 m. `ThreatRingDef` is `{ label: string; radiusM: number; colorKey: keyof typeof RING_COLORS }`. `RING_COLORS` keys: `lethal`, `warning`, `safe`, `info`, `dead`, `exclusion`.

Graphic attribute types: `buffer_ring`, `buffer_label` (with `label`).

2D vs 3D: 3D uses extruded fills and 3D text labels with callouts; 2D uses flat fills. Reprojection uses `webMercatorUtils`; no network service is involved.

---

## EffectEngine

Munition effects radii (blast overpressure, fragmentation, thermal, quantity-distance) around one or more detonation points, with a strike animation. Module: `MS/Engines/Analysis/EffectEngine.ts`. Unlike the other engines it has **no default export**: it is `export class EffectEngine` (import it as `{ EffectEngine }`). The registry does the same. A stray empty file `EffectEngine.ts.ts` exists next to it and contains no code.

Layer ids: `ANALYSIS_LAYER_ID = 'effects-analysis'`, `MARKER_LAYER_ID = 'effects-marker'`, `ANIM_LAYER_ID = 'effects-anim'`, `COMMITTED_LAYER_ID = 'effects-committed'`.

### open(graphic?: Graphic | null, view?: MapView | SceneView): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic \| null \| undefined` | `undefined` | Seeds the first strike at the symbol's point/centroid. |
| `view` | `MapView \| SceneView \| undefined` | `undefined` | Calls `initialize(view)` when given. |

Notes: if the panel was closed with strikes still present, `open()` restores it instead of resetting. Otherwise it clears strikes, shows the panel and legend and starts a map pick for detonation points. No re-edit of committed results.

### computeEffects(munition: string, structureFactor = 'open_area', tntOverrideKg: number | null = null, detonationHeightOverride: number | null = null): any

Pure function (exported), usable without a view.

| name | type | default | meaning |
| --- | --- | --- | --- |
| `munition` | `string` | none | Key of `MUNITION_PRESETS`; unknown keys fall back to `mortar_81mm`. |
| `structureFactor` | `string` | `'open_area'` | Key of `STRUCTURE_FACTORS`; unknown falls back to `open_area`. |
| `tntOverrideKg` | `number \| null` | `null` | TNT-equivalent override; used only when greater than 0. |
| `detonationHeightOverride` | `number \| null` | `null` | Burst height in metres; otherwise the preset's `detonationHeightM`. |

Returns `{ munition, structureFactor, detonationHeightM, rings }`, where `rings` is an array of `{ id, label, radiusM, colorKey, opacity }` sorted by descending radius, with rings of 0.5 m or less removed. Ring ids: `lethal_composite`, `injury_blast`, `frag_casualty`, `thermal`, `safe_blast`, `qd_inhabited`. The return type is `any` in the source.

### Other exports

- `MUNITION_PRESETS: Record<string, any>` keys: `mortar_60mm`, `mortar_81mm`, `artillery_105mm`, `artillery_155mm`, `ied_10kg`, `vbied_100kg`, `gbbu_500lb`, `thermobaric`. Fields: `label`, `tntEquivKg`, `fragmentVelocityMS`, `casingMassRatio`, `detonationHeightM`, `color`, `icon`.
- `STRUCTURE_FACTORS: Record<string, any>` keys: `open_area`, `light_urban`, `masonry`, `reinforced_concrete`, `reenforced_shelter` (sic). Fields: `label`, `blastMult`, `fragMult`.
- `EFFECTS_COLORS: Record<string, { fill: number[]; outline: number[] }>`.
- `destinationPoint(lon: number, lat: number, bearingDeg: number, distM: number): { longitude: number; latitude: number }` (spherical, R = 6,371,008.8 m).

```ts
import { computeEffects } from '@lib/Engines/Analysis/EffectEngine';
const { rings } = computeEffects('artillery_155mm', 'masonry');
```

The import path above is illustrative; in the shipped build, check which of these module-level exports are actually re-exported (the build entry is `SymbolEngine.ts`). The class itself is reached through `symbolEngine.effectEngine`.

2D vs 3D: the file contains no `view.type === '3d'` branch; it imports `Mesh`, so treat 3D rendering as not verified here.

---

## CorridorEngine

Route corridor / MSR analysis: draw waypoints, evaluate exposure per segment against threat zones, standoff and exclusion distances, detect chokepoints, and optionally snap the route to real roads. Module: `MS/Engines/Analysis/CorridorEngine.ts`. It imports its maths from `corridor-engine.js` (same folder).

Layer ids: `ANALYSIS_LAYER_ID = 'corridor-analysis'`, `THREAT_LAYER_ID = 'corridor-threats'`, `COMMITTED_LAYER_ID = 'corridor-committed'`, `PREVIEW_LAYER_ID = 'corridor-preview'`.

### open(graphic: Graphic, view: MapView | SceneView): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic` | none (required; the source dereferences `graphic.attributes` without a null check) | If its point/centroid exists and no waypoints are set, it becomes the first waypoint. |
| `view` | `MapView \| SceneView` | none | View to analyse in. |

Notes:

- Re-edit: `attributes.type === 'corridor_zone'` with `committedAt`. Restored keys (`CorridorAnalysisMeta`): `presetKey`, `waypoints`, `corridorM`, `standoffM`, `exclusionM`, `segmentLenM`.
- If the panel exists but is hidden, `open()` shows it again and returns without reading the graphic.

Presets (`corridor-engine.js`, keys and defaults):

| Key | Label | corridorM | standoffM | exclusionM | segmentLenM |
| --- | --- | --- | --- | --- | --- |
| `foot_patrol` | Foot patrol | 25 | 100 | 0 | 100 |
| `vehicle_patrol` | Vehicle patrol / MSR | 100 | 500 | 1000 | 200 |
| `heavy_convoy` | Heavy convoy | 200 | 1000 | 2000 | 300 |
| `drone_flyway` | Drone flyway | 150 | 800 | 0 | 150 |
| `exfil_route` | Exfil / covert route | 50 | 300 | 500 | 100 |

Built-in threat overlay templates (panel, not exported): high 2000 m, medium 1200 m, low 700 m, observation 3000 m.

Road snapping: a panel checkbox (`_snapToRoads`) asks `symbolEngine.roadNetworkEngine` for a road-following path and reports distance, drive time and a `TrafficabilitySummary`. If the road service is unreachable or disabled the corridor keeps its straight-line geometry. See [11b RoadNetworkEngine](11b-terrain-and-road.md#roadnetworkengine).

---

## FlightEngine

UAV route planning and coverage analysis: waypoints with altitude, sensor footprint, endurance/return-leg metrics, weapon reach for armed presets, and a playback timeline. Module: `MS/Engines/Analysis/FlightEngine.ts`.

Layer ids: `ROUTE_LAYER_ID = 'flight-route'`, `COVERAGE_LAYER_ID = 'flight-coverage'`, `VEHICLE_LAYER_ID = 'flight-vehicle'`, `COMMITTED_LAYER_ID = 'flight-committed'`.

### open(graphic: Graphic, view: MapView | SceneView): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic` | none (required) | Its point/centroid becomes the first waypoint (start), at the panel's current altitude. |
| `view` | `MapView \| SceneView` | none | View. |

Notes:

- Re-edit: `attributes.type === 'flight_plan'` **and** `attributes.flightPlanJson` present. The JSON is loaded and the panel opens in committed-plan mode. (This differs from the other engines, which key off `committedAt`.)
- Animation and pending picks are stopped on every `open()`.

### Exports

`UAV_PRESETS: Record<string, FlightPreset>`; `FlightPreset` fields: `label`, `role`, `speedKmh`, `enduranceMin`, `altitudeM`, `sensorRangeM`, `sensorFovDeg`, `armed`, `weaponRangeM`, `color`, `accentHex`.

| Key | Label | speedKmh | enduranceMin | armed |
| --- | --- | --- | --- | --- |
| `quadcopter` | Quadcopter ISR | 45 | 35 | false |
| `fixed_wing` | Small Fixed-Wing | 95 | 150 | false |
| `male_isr` | MALE ISR UAV | 180 | 900 | false |
| `armed_uav` | Armed UAV | 155 | 600 | true |
| `relay` | Comms Relay Orbit | 75 | 240 | false |

2D vs 3D: the point geometry helper differs per view (`makeSurfacePoint` in 3D, `makePoint(..., altitudeM)` in 2D). No network call (`fetch`) appears in the file; the route is not road-snapped.

---

## Intervisibility

Not a registered engine. Exposed as two methods on `SymbolEngine` (implementation in `MS/Engines/Analysis/Intervisibility/IntervisibilityEngine.ts`, constructed unconditionally).

### showIntervisibility(opts?: { observerHeightM?: number }): Promise<unknown>

Computes the N by N "who sees whom" terrain line-of-sight matrix for point symbols and draws the network (green = mutual, amber dashed = one way) plus a matrix panel.

| name | type | default | meaning |
| --- | --- | --- | --- |
| `opts.observerHeightM` | `number` | `2` | Eye height above ground used for every node (default applied in `IntervisibilityEngine.analyze`). |

Input selection: currently selected point graphics; if fewer than 2 are selected, every point graphic on the `FORCE` and `TACT_PT` layers.

Return: the promise resolves to `IntervisibilityResult | null` (declared `Promise<unknown>` on `SymbolEngine`). `null` when there is no view or fewer than 2 nodes (a hint is logged). At most 14 nodes are used; extra ones are dropped with a logged message.

```ts
interface IntervisibilityResult {
  labels: string[];
  visible: boolean[][];     // visible[i][j] = node i can see node j (directional)
  connectivity: number[];   // mutual-link count per node
}
```

### clearIntervisibility(): void

Removes the network overlay and matrix panel.

```ts
const result = await symbolEngine.showIntervisibility({ observerHeightM: 1.8 }) as IntervisibilityResult | null;
symbolEngine.clearIntervisibility();
```

It samples ground elevation at a 30 m step along each ray; `view.map.ground` elevation must be available.
