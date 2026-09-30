# 11. Analysis engines (overview and registry)

This document describes how the PAMS8 analysis suite is constructed, enabled, enumerated and torn down, and the conventions shared by every analysis engine. Per-engine reference is split across three sibling files.

Related documents: [README](README.md) | [01 Getting started](01-getting-started.md) | [02 SymbolEngine API](02-symbol-engine-api.md) | [08 Settings](08-settings.md) | [09 Measurement, cues, MGRS](09-measurement-cues-mgrs.md) | [14 FAQ and troubleshooting](14-faq-troubleshooting.md)

| File | Contents |
| --- | --- |
| [11a-los-wez-trajectory.md](11a-los-wez-trajectory.md) | LOS, Weapon Effect Zone, Trajectory, Buffer and Threat Rings, Effect, Corridor, UAV Flight, Intervisibility |
| [11b-terrain-and-road.md](11b-terrain-and-road.md) | Dead Ground Mapper, Key Terrain, Local Peaks, Position Defensibility Scorer, OP Ranker, Landing Zone, Airspace, RoadNetworkEngine, TrafficabilityEngine |
| [11c-planning-ocoka-mission-deployment.md](11c-planning-ocoka-mission-deployment.md) | OCOKA, Mission Planner, Deployment Builder |

## 11.1 Scope of the public API

Analysis engines are UI-driven. Almost all of them are panels (draggable widgets) that read their parameters from DOM controls, draw into private `GraphicsLayer`s and offer a "Commit" button. The **programmatic** surface that a host can rely on is therefore small:

- The lifecycle methods every engine shares: `initialize(view)`, `open(...)`, `close()`, `destroy()` (see [11.4](#114-common-engine-contract)).
- Six engines additionally expose a **headless** compute method that returns typed results without opening a panel and without drawing (see [11.6](#116-headless-compute-methods)).
- `RoadNetworkEngine` is a genuine service adapter with a full programmatic API (route, service area, availability).

Panel parameters (ranges, azimuths, presets and so on) are not settable through the engine API. Where the source exposes no setter, this documentation says so.

## 11.2 The 16 registered engines

`MS/Engines/AnalysisEngineRegistry.ts` owns construction, destruction, view re-attachment and runtime enable/disable of the following engines. (The source comments still say "14 engines"; the registry currently defines 16 keys.)

The registry class is `default export class AnalysisEngineRegistry` and is created internally by `SymbolEngine`. `SymbolEngine` does not expose the registry object itself (its field is private); hosts use the typed getters on `SymbolEngine`.

| `AnalysisKey` | `SymbolEngine` getter | Class | Ready event (detail: `{ engine }`) | Settings flag |
| --- | --- | --- | --- | --- |
| `wez` | `weaponEffectEngine` | `WeaponEffectEngine` | `weaponEffectEngineReady` | `analysis.wez` |
| `los` | `losEngine` | `LOSEngine` | `losEngineReady` | `analysis.los` |
| `trajectory` | `trajectoryEngine` | `TrajectoryEngine` | `trajectoryEngineReady` | `analysis.trajectory` |
| `buffer` | `bufferEngine` | `BufferEngine` | `bufferEngineReady` | `analysis.buffer` |
| `corridor` | `corridorEngine` | `CorridorEngine` | `corridorEngineReady` | `analysis.corridor` |
| `effects` | `effectEngine` | `EffectEngine` | `effectEngineReady` | `analysis.effects` |
| `flight` | `flightEngine` | `FlightEngine` | `flightEngineReady` | `analysis.flight` |
| `deadGround` | `deadGroundMapper` | `DeadGroundMapper` | `deadGroundMapperReady` | `analysis.deadGround` |
| `keyTerrain` | `keyTerrainIdentificationEngine` | `KeyTerrainIdentificationEngine` | `keyTerrainIdentificationEngineReady` | `analysis.keyTerrain` |
| `positionDefensibility` | `posDefScorerEngine` | `PosDefScorerEngine` | `posDefScorerEngineReady` | `analysis.positionDefensibility` |
| `opRanker` | `opRankerEngine` | `OpRankerEngine` | `opRankerEngineReady` | `analysis.opRanker` |
| `localPeaks` | `localPeaksEngine` | `LocalPeaksEngine` | `localPeaksEngineReady` | `analysis.localPeaks` |
| `ocoka` | `ocokaEngine` | `OcokaEngine` | `ocokaEngineReady` | `analysis.ocoka` |
| `missionPlanner` | `missionPlannerEngine` | `MissionPlannerEngine` | `missionPlannerEngineReady` | `analysis.missionPlanner` |
| `landingZone` | `landingZoneEngine` | `LandingZoneEngine` | `landingZoneEngineReady` | `analysis.landingZone` |
| `airspace` | `airspaceEngine` | `AirspaceEngine` | `airspaceEngineReady` | `analysis.airspace` |

Each getter has type `<Class> | null`. It is `null` until the engine has been constructed and after it has been disabled or destroyed.

Engines that are **not** in the registry but are analysis-related:

| Engine | `SymbolEngine` member | Gate | Ready event |
| --- | --- | --- | --- |
| `RoadNetworkEngine` | `roadNetworkEngine` (getter, `RoadNetworkEngine \| null`) | `features.roadNetwork` and a successful backend probe | `roadNetworkEngineReady` |
| `TrafficabilityEngine` | `trafficabilityEngine` (getter, `TrafficabilityEngine \| null`) | created only after the road backend probe succeeds | `trafficabilityEngineReady` |
| `DeploymentBuilderEngine` | none (no getter); set on `window.deploymentBuilderEngine` | `features.deploymentBuilder` | `deploymentBuilderEngineReady` |
| Intervisibility | `showIntervisibility()` / `clearIntervisibility()` methods | always constructed | none |

### Ready events

`SymbolEngine` dispatches each ready event as a `CustomEvent` (`bubbles: true`, `cancelable: true`, `detail: { engine }`) from `view.container` (falling back to `document` if the container is null). Listen on the view container or an ancestor:

```ts
view.container.addEventListener('losEngineReady', (e) => {
  const engine = (e as CustomEvent).detail.engine; // LOSEngine
});
```

Because engines are created lazily on browser idle time (see `initAll` below), a host that needs an engine immediately after `new SymbolEngine(...)` must either wait for the ready event or poll the getter for non-null.

## 11.3 Enabling, disabling and enumerating

### Boot behaviour

`SymbolEngine` constructs the registry and calls `initAll()` during its own initialisation. `init(key)` is skipped when any of these hold:

- `settingsData.features.analysisEngines === false` (master switch),
- `settingsData.analysis[key] === false`,
- the engine already exists.

Both flags default to `true` in `MS/Data/Settings.json`. Only an explicit `false` disables an engine; a missing key counts as enabled.

### Registry methods

These are the members of `AnalysisEngineRegistry`. They are reachable from a host only if it constructs the registry itself; through `SymbolEngine` the same effects are reached by `onSettingChanged` (below).

### has(key: AnalysisKey): boolean

True if the engine has been constructed.

### init(key: AnalysisKey): void

Constructs the engine, calls `inst.initialize(getView())`, stores it, links it into `ContextMenuManager` (so it appears under right-click, "More Actions", Analysis) and emits the ready event. No-op under the conditions listed above.

### destroy(key: AnalysisKey): void

Calls `inst.destroy?.()`, clears the instance and unlinks it from the context menu.

### initAll(force: boolean = false): void

| name | type | default | meaning |
| --- | --- | --- | --- |
| `force` | `boolean` | `false` | `true` builds every enabled engine synchronously. `false` builds one engine per `requestIdleCallback` tick (`{ timeout: 250 }`), or one per `setTimeout(0)` when `requestIdleCallback` is unavailable. |

### destroyAll(): void

Destroys every engine and calls `contextMenuManager.unlinkAnalysisEngines()`.

### setEnabled(key: AnalysisKey, enabled: boolean): void

`true` calls `init(key)`, `false` calls `destroy(key)`.

### onViewChanged(newView: MapView | SceneView): void

Re-attaches every loaded engine. Each engine gets `initialize(newView)`, except `missionPlanner`, which gets `onViewChanged(newView)`. `SymbolEngine.onViewChanged` calls this for you on a 2D/3D switch.

### Runtime toggling through SymbolEngine

The supported host-facing way to enable or disable engines is `SymbolEngine.onSettingChanged(path: string[], value: any): void` (see [08 Settings](08-settings.md)):

```ts
// Turn one engine off, then on again
symbolEngine.onSettingChanged(['analysis', 'los'], false);   // destroys LOSEngine
symbolEngine.onSettingChanged(['analysis', 'los'], true);    // rebuilds it

// Master switch
symbolEngine.onSettingChanged(['features', 'analysisEngines'], false); // destroyAll()
symbolEngine.onSettingChanged(['features', 'analysisEngines'], true);  // initAll(true), synchronous
```

Behaviour verified in `SymbolEngine.onSettingChanged`:

- `features.analysisEngines` `false` calls `destroyAll()`; `true` calls `initAll(true)`.
- Any path starting with `analysis.` calls `setEnabled(path[1], !!value)`, but only while `features.analysisEngines !== false`. `path[1]` is not validated against `AnalysisKey`; an unknown key would reach `SPECS[key]` and is not guarded. Use only the keys in the table above.
- The change is also written into the in-memory `settingsData` tree, so a later `init()` sees it.
- The legacy `settingsChanged` `CustomEvent` (on `window`, `detail: { path, value, fullPath }`) reaches the same handler; `index.html` uses it.

### Enumerating what is loaded

There is no `list()` method. Enumerate by reading the getters:

```ts
const analysisGetters = [
  'weaponEffectEngine', 'losEngine', 'trajectoryEngine', 'bufferEngine',
  'corridorEngine', 'effectEngine', 'flightEngine', 'deadGroundMapper',
  'keyTerrainIdentificationEngine', 'posDefScorerEngine', 'opRankerEngine',
  'localPeaksEngine', 'ocokaEngine', 'missionPlannerEngine',
  'landingZoneEngine', 'airspaceEngine',
] as const;

const loaded = analysisGetters.filter((g) => symbolEngine[g] !== null);
```

### Activating from a host UI

`src/main.ts` (Analysis Hub) shows the real pattern. Engines are opened directly through the getters, using the selected graphic when one exists:

```ts
const se = (window as any).symbolEngine;

// Open with or without a symbol (graphic may be undefined)
se.losEngine?.open(graphic ?? undefined, se.view);
se.weaponEffectEngine?.open(graphic ?? undefined, se.view);
se.trajectoryEngine?.open(graphic ?? undefined, se.view);
se.bufferEngine?.open(graphic ?? undefined, se.view);
se.effectEngine?.open(graphic ?? undefined, se.view);
se.deadGroundMapper?.open(graphic ?? undefined, se.view);
se.keyTerrainIdentificationEngine?.open(graphic ?? undefined, se.view);
se.localPeaksEngine?.open(undefined, se.view);
se.ocokaEngine?.open(graphic ?? undefined, se.view);

// "openWidget" engines (no symbol needed)
se.posDefScorerEngine?.openWidget(se.view);
se.opRankerEngine?.openWidget(se.view);
se.missionPlannerEngine?.openWidget(se.view);
se.landingZoneEngine?.openWidget(se.view);
se.airspaceEngine?.openWidget(se.view);

// Context tools that require a graphic
se.corridorEngine?.open(graphic, se.view);
se.flightEngine?.open(graphic, se.view);

// Trafficability
se.trafficabilityEngine?.open(graphic ?? undefined, se.view);
```

`src/main.ts` also defines `window.keyTerrainEngine`, `posDefScorerEngine`, `opRankerEngine`, `localPeaksEngine`, `ocokaEngine`, `missionPlannerEngine`, `landingZoneEngine` and `airspaceEngine` as getters that forward to the `SymbolEngine` getters. These are host-harness conveniences, not part of the library. `SymbolEngine` itself sets `window.roadNetworkEngine`, `window.trafficabilityEngine` and `window.deploymentBuilderEngine`.

## 11.4 Common engine contract

All registered engines follow the same shape. Signature differences are listed in the per-engine sections.

### initialize(view: MapView | SceneView): void

Stores the view and adds the engine's private `GraphicsLayer`s to `view.map` (only if a layer with the same id is not already present). Idempotent for the same view (`if (this._view === view) return`). Called by the registry; a host should not need to call it.

### open(graphic?, view?): void

Opens the engine's panel. Argument rules vary:

| Form | Engines |
| --- | --- |
| `open(graphic?: Graphic \| null, view?: MapView \| SceneView)` | WEZ, Trajectory, Buffer, Effect, Key Terrain, OCOKA |
| `open(graphic: Graphic \| undefined, view: MapView \| SceneView)` | LOS, Dead Ground Mapper |
| `open(graphic?: Graphic, view?: MapView \| SceneView)` | Local Peaks, Mission Planner |
| `open(graphic: Graphic, view: MapView \| SceneView)` (graphic required) | Corridor, Flight, PosDef, OP Ranker, Landing Zone, Airspace |
| `open(graphic?: Graphic \| null, view?: MapView \| SceneView, roadNet?: RoadNetworkEngine)` | Trafficability |

When a point graphic is supplied, its geometry seeds the observer/origin. For non-point graphics the engines fall back to `geometry.centroid`. When omitted, most panels prompt the user to click the map.

### close(): void

Hides the panel and clears working graphics. Committed layers are kept.

### destroy(): void

Calls `close()`, removes the engine's layers from the map and removes its DOM panels. The registry calls this on disable.

### Layers

Each engine exposes its layer ids as `static readonly` constants (for example `LOSEngine.ANALYSIS_LAYER_ID = 'los-analysis'`). They are listed per engine. Working layers are cleared on every run; a `*-committed` layer holds results the user committed and survives `close()`.

### Committed results and re-edit

Where an engine supports re-editing, passing a committed graphic (identified by `attributes.type` and `attributes.committedAt`) to `open()` reloads its parameters into the panel. Verified for WEZ (`wez_zone`), LOS (`los_viewshed`), Trajectory (`trajectory_arc`), Corridor (`corridor_zone`) and Flight (`flight_plan`, requires `attributes.flightPlanJson`). Other engines have no re-edit path.

## 11.5 Settings

### `analysis.*` flags

`MS/Data/Settings.json` holds only booleans under `analysis`:

```json
"analysis": {
  "los": true, "wez": true, "trajectory": true, "buffer": true,
  "corridor": true, "flight": true, "effects": true, "deadGround": true,
  "keyTerrain": true, "positionDefensibility": true, "opRanker": true,
  "localPeaks": true, "missionPlanner": true, "ocoka": true,
  "landingZone": true, "airspace": true
}
```

Related top-level keys: `features.analysisEngines` (master, default `true`), `features.roadNetwork` (default `true`), `features.deploymentBuilder` (default `true`), and the `roadNetwork` object (see [11b](11b-terrain-and-road.md#roadnetworkengine)). Per-engine tuning parameters are not stored in `Settings.json`; they live in each panel's controls.

### AnalysisSettings manifest and widget

`MS/Engines/AnalysisSettingsManifest.ts` exports `analysisSettingsManifest: SettingDescriptor[]`. Each entry is a boolean toggle with `path` `['analysis', key]` (the first entry is `['features', 'analysisEngines']`), grouped as follows:

| Group | Keys |
| --- | --- |
| Engine | `features.analysisEngines` |
| Terrain | `keyTerrain`, `localPeaks`, `deadGround`, `ocoka` |
| Force & position | `los`, `positionDefensibility`, `opRanker` |
| Weapons & threats | `wez`, `trajectory`, `effects`, `buffer`, `airspace` |
| Route & mission | `corridor`, `flight`, `missionPlanner`, `landingZone` |

`airspace` is declared through the `weap()` helper, so it appears under "Weapons & threats".

`MS/Engines/AnalysisSettingsWidget.ts` exports `openAnalysisSettings(opts?: { anchor?: { x?: number; y?: number }; focusGroup?: string }): SettingsWidgetHandle` (also the default export and assigned to `window.openAnalysisSettings`). It mounts the widget with id `analysis-settings` and title "Analysis engines". As a side effect of importing the module it registers a Ctrl+K palette entry (`id: 'analysis'`, category `Engines`). `SymbolEngine` imports it for that side effect. See [08 Settings](08-settings.md) for `SettingDescriptor` and the settings bus.

## 11.6 Headless compute methods

These return data without opening a panel. They require `initialize(view)` to have been called (the registry does this). They throw `Error('<Engine> requires initialize(view) before <method>()')` otherwise.

| Engine | Method | Result |
| --- | --- | --- |
| `LocalPeaksEngine` | `runHeadless(options?)` | `Promise<LocalPeakResult[]>` |
| `KeyTerrainIdentificationEngine` | `runHeadless(options?)` | `Promise<KeyTerrainFeature[]>` |
| `DeadGroundMapper` | `runHeadless(options)` | `Promise<DeadGroundSummary>` |
| `PosDefScorerEngine` | `scorePoint(point, options?)` | `Promise<DefensibilitySummary>` |
| `OpRankerEngine` | `rankCandidates(points, options?)` | `Promise<OpRankSummary>` |
| `OcokaEngine` | `runHeadless(options?)` | `Promise<OcokaCorridor[]>` |
| `MissionPlannerEngine` | `runHeadless(options?)` | `Promise<MissionTerrainFeature[]>` |

LOS, WEZ, Trajectory, Buffer, Effect, Corridor and Flight have no headless method. `EffectEngine.ts` does export pure functions and preset tables that can be used without a view (see [11a](11a-los-wez-trajectory.md#effectengine)).

## 11.7 External dependencies and offline behaviour

| Dependency | Used by | If unavailable |
| --- | --- | --- |
| ArcGIS elevation (`view.map.ground`, `createElevationSampler`, `queryElevation`) | LOS, WEZ terrain mask, Trajectory, Dead Ground, Key Terrain, Peaks, PosDef, OP Ranker, OCOKA, Mission Planner, Landing Zone, Intervisibility | Behaviour differs per engine. Several headless paths catch the failed elevation query, log through `EngineLogger.error` and continue with a 0 m base (Dead Ground, PosDef, OP Ranker). OCOKA falls back to a synthetic terrain surface (`pseudoTerrain`) when no DEM sample is available; its corridor notes document this. Other engines were not audited for this failure path; do not assume they degrade. |
| Road-network service (ArcGIS Server Network Analyst, "NAServer") via `RoadNetworkEngine` | Corridor (snap to roads), Key Terrain, OP Ranker, PosDef, OCOKA, Mission Planner, Trafficability, MeasurementEngine road ETA | Never a hard failure. All calls resolve to a `RoadResult` with `ok: false`; consumers keep their straight-line or terrain-only result. Details in [11b](11b-terrain-and-road.md#roadnetworkengine). |
| Registry JSON `/MS/Data/Deployments/Deployemets.json` (and plan files) | Deployment Builder | Plan list is empty ("No plans available"); an error is logged. See [11c](11c-planning-ocoka-mission-deployment.md#deploymentbuilderengine). |

Important wiring detail: the sub-engines above reach the road adapter through `(window as any).symbolEngine?.roadNetworkEngine`. A host application that builds a `SymbolEngine` but does **not** assign it to `window.symbolEngine` will silently lose road enrichment in those engines (they treat a missing adapter as "offline"). The reference harness sets `window.symbolEngine = symbolEngine` in `src/main.ts`.

## 11.8 2D and 3D

All engines run on both `MapView` and `SceneView`; `SymbolEngine.onViewChanged` re-attaches them. General pattern, verified by `view.type === '3d'` branches in the source:

- Zone/ring graphics use flat fills in 2D and extruded or mesh symbols in 3D (WEZ, Buffer, Effect, Flight, Trajectory, Dead Ground).
- LOS uses elevation-sampler ray casting in both views and adds ArcGIS native LOS/viewshed analyses in 3D only.
- Dead Ground renders a heatmap layer in 2D and a mesh layer in 3D (layer ids `dead-ground-mesh`, `dead-ground-viewshed-dome`, and so on).
- Flight builds its point geometry with `makeSurfacePoint` when the view is 3D and with `makePoint(..., altitudeM)` otherwise (literal `_is3D()` branches in `FlightEngine.ts`).

Where the source only shows a small difference, the per-engine sections do not repeat it.

## 11.9 Teardown checklist for embedders

- `SymbolEngine.destroy()` (see [02](02-symbol-engine-api.md)) does **not** call the registry's `destroyAll()`, and does not destroy `RoadNetworkEngine`, `TrafficabilityEngine` or `DeploymentBuilderEngine` (verified in the method body). Before unmounting a map, drop analysis explicitly with `onSettingChanged(['features','analysisEngines'], false)` (which calls `destroyAll()`), then call `symbolEngine.destroy()`.
- The road, trafficability and deployment engines have no disable path through the registry. Destroy them directly if the host owns their lifetime: `symbolEngine.roadNetworkEngine?.destroy()`, `symbolEngine.trafficabilityEngine?.destroy()`, `window.deploymentBuilderEngine?.destroy()`. Turning `features.roadNetwork` off keeps the `RoadNetworkEngine` instance but hides its roads layer and closes Trafficability.
- `DeploymentBuilderEngine` is a process-wide singleton; `destroy()` clears the singleton so `getInstance()` builds a fresh one.
- `RoadNetworkEngine.destroy()` clears its status listeners; `onStatusChange` subscribers must resubscribe on a new instance.
