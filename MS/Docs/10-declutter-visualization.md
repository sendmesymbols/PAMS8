# 10 - Declutter and visualization

This document covers the declutter subsystem (`Engines/Declutter/*`) that keeps dense scenes readable, and `VisualizationEngine` (`Engines/Visualization/*`) that adds force-analysis overlays, threat sectors, an MGRS density heat map and 3D render settings.

Related documents: [README](README.md) | [SymbolEngine API](02-symbol-engine-api.md) | [Support classes](04-support-classes.md) | [Settings](08-settings.md) | [Measurement, cues, MGRS](09-measurement-cues-mgrs.md) | [Analysis engines](11-analysis-engines.md)

| Component | Role | Host access |
| --- | --- | --- |
| [DeclutterEngine](#declutterengine) | Zoom/echelon visibility of symbols and labels; hosts the solve pipeline that the other declutter engines plug into | Settings only (see below) |
| [ClusterEngine](#clusterengine) | Replaces nearby symbols by a count badge or a seed symbol with an x-N tag | Settings only |
| [LadderEngine](#ladderengine) | Stacks nearby symbols into a vertical "halyard" | Settings only |
| [MarkerDisperser](#markerdisperser) | Fans out symbols stacked at one spot on a circle | Settings only |
| [LabelPlacer](#labelplacer) | Maplex-style label placement with leader lines | Settings only |
| [SpatialIndex](#spatialindex) | Screen-space grid hash shared by the solve steps | Via `DeclutterEngine.spatialIndex` |
| [PriorityResolver](#priorityresolver) | Importance score per graphic | Exported functions |
| [VisualizationEngine](#visualizationengine) | Coverage rings, force-ratio grid, hulls, extruded footprints, layer effects, sectors, MGRS density, 3D render settings | `symbolEngine.visualizationEngine` |

---

## Access model for the declutter engines

`SymbolEngine` creates `DeclutterEngine`, `ClusterEngine`, `LabelPlacer`, `LadderEngine` and `MarkerDisperser` at construction and keeps them in private fields. There are no public accessors for them on `SymbolEngine`. The supported way for a host to control them is through settings (see [08](08-settings.md)):

```ts
symbolEngine.onSettingChanged(['declutter', 'enabled'], true);
symbolEngine.onSettingChanged(['declutter', 'cluster', 'enabled'], true);
symbolEngine.onSettingChanged(['declutter', 'cluster', 'radiusPx'], 60);   // refreshes automatically
```

`SymbolEngine.onSettingChanged` enables or disables the matching engine for `declutter.enabled` and `declutter.{cluster,labels,disperse,ladder}.enabled`, and calls `refresh()` on the affected engines for any other `declutter.*` change. The classes are exported from their modules, but constructing a second set would attach a second set of watchers to the same layers; that use is not supported by `SymbolEngine`. The test harness reaches `symbolEngine._declutterEngine` (a private field) for its perf HUD; do not copy that.

All declutter engines read `Settings.json` live at solve time. Their `enable()` / `disable()` methods control whether the engine's solve step is registered, but `DeclutterEngine` itself also checks `declutter.enabled` in several code paths, so calling `enable()` directly while `declutter.enabled` is false has little effect. Use the settings.

Settings keys and defaults are in the [settings reference](08-settings.md#declutter). Some code fallbacks differ from the shipped JSON (the JSON wins whenever the key exists): `cluster.minClusterSize` fallback 3 (JSON 2), `cluster.radiusPx` 40 (JSON 80), `ladder.maxZoom` 17 (JSON 20), `ladder.spineWidth` 1 (JSON 2), `ladder.spineOpacity` 0.7 (JSON 0.8), `ladder.altitudeMode` false unless exactly true (JSON true), `disperse.minZoom` 14 (JSON 11).

### Layers

| Layer id (`LAYER_NAMES`) | Used by |
| --- | --- |
| `ForceSymbolsLayer` (`FORCE`), `TacticalPointSymbolsLayer` (`TACT_PT`), `TacticalSymbolsLayer` (`TACT`), `milSymbols` (legacy) | The symbol layers (`SYMBOL_LAYER_IDS`) scanned by the index, echelon filtering and hide-below |
| `AnnotationLayer` (`ANNOTATION_LAYER`) | Labels: annotation modes, LabelPlacer |
| `ClusterBadgeLayer` (`CLUSTER`) | Cluster badges |
| `LeaderLineLayer` (`LEADER_LINE`) | Label leader lines |
| `LadderLineLayer` (`LADDER`) | Ladder spines and tie-lines |

### Requirements on graphics

- Only graphics with a non-empty `attributes.id` enter the spatial index. Graphics without an id are ignored by cluster, ladder, disperse and the label priority lookup.
- Disperse and ladder handle only point geometries. Cluster works on whatever the index holds, which is point-position based (`view.toScreen(geometry)`).
- Symbols already hidden (`graphic.visible === false`) by other rules are skipped by cluster, disperse and ladder.
- Labels are `AnnotationLayer` graphics with a `TextSymbol`; their priority comes from the parent symbol found through `attributes.parentId`.

### Side effects a host should know

- Declutter changes `graphic.visible`, and layer `visible`, `opacity` and `minScale`. Do not rely on these values being untouched while declutter is on. `disable()` restores visibility, opacity and `minScale` on the annotation and symbol layers.
- Disperse and ladder temporarily **move** point graphics (they set `graphic.geometry`) and cache the true position in graphic attributes (`__dspOrigX`, `__dspOrigY`, `__dspOrigWkid`, `__dspLastSetX`, `__dspLastSetY`; `__ladOrigX`, `__ladOrigY`, `__ladOrigWkid`, `__ladLastSetX`, `__ladLastSetY`; and `__ladderRung` on ladder members). While active, `graphic.geometry` is the displaced position. No code outside `Engines/Declutter/` references these attributes, so a host that serializes or exports geometry while disperse or ladder is active would capture displaced positions. Disable them, or export at a zoom outside their band, when exact positions matter. If the user moves a displaced graphic, the engines detect the change and adopt the new position as the true one.
- LabelPlacer moves label graphics and can replace label text with an abbreviation (original kept in `__lblOrigText`). Other attributes it uses: `__lblAnchorX`, `__lblAnchorY`, `__lblPlaced`, `__lblHidden`, `__lblLastSetX`, `__lblLastSetY`.
- Cluster badges carry attributes `__isCluster`, `clusterCount`, `clusterGroup`, `clusterMemberIds` (and `__isClusterCount`, `__isClusterText` for the text parts). Host code that enumerates `ClusterBadgeLayer` should treat them as transient.
- In altitude mode LadderEngine switches the elevation mode of the ladder layer and every symbol layer to `relative-to-ground` and restores the original modes when altitude mode ends or the engine is disabled.

### Zoom source and views

All zoom logic reads `view.zoom`. `DeclutterEngine` returns without acting when it is `undefined`. The engines re-attach on a 2D/3D switch through `SymbolEngine.onViewChanged(newView)`, which passes each engine the new `GraphicsLayerManager` (the 2D and 3D views use different manager instances). The spatial-index fingerprint includes camera heading and tilt for `SceneView`, so rotating or tilting the 3D camera triggers a rebuild.

---

## DeclutterEngine

Module: `Engines/Declutter/DeclutterEngine` (named export `DeclutterEngine`, default export the same class).

```ts
new DeclutterEngine(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager)
```

The constructor attaches watchers immediately (zoom, view `stationary`, and the `graphics` collections of every symbol layer plus the annotation layer). Nothing is applied until `enable()`.

### Annotation (label) declutter

Selected by `declutter.annotations.mode`:

| Mode | Behavior |
| --- | --- |
| `off` | Annotation layer fully visible, no `minScale`. |
| `zoom` | Annotation layer hidden below `annotations.zoomThreshold`, with an eased opacity fade of `annotations.fadeMs` ms. |
| `minscale` | Sets the annotation layer `minScale = 591657550.5 / 2^zoomThreshold` (Web Mercator scale at zoom 0 divided by 2 per level). No fade. |
| `density` | Screen-grid thinning: one label per `annotations.densityMinPx` px cell; the first label encountered in layer order wins (not priority-based). Re-evaluated when the view becomes stationary and when annotations are added. |

Switching mode cleans up the previous mode's state (resets `minScale`, re-shows density-hidden labels).

### Symbol declutter

| Setting | Behavior |
| --- | --- |
| `symbols.hideBelow` = true | Symbol layers fade out (opacity to 0, then `visible = false`) below `symbols.zoomThreshold`, using the fractional zoom, and fade in when zoom rises above it. Duration `symbols.fadeMs`. |
| `symbols.echelonBased` = true | On each change of the integer zoom, per-graphic visibility follows the `ZoomLvlEchelon` table (greatest key not above the current integer zoom). A graphic is visible if its echelon code is in the list. Graphics with unknown echelon (`"00"`) are visible because the tables contain `"00"`. Applied with a flash (fade out, update, fade in) over `symbols.fadeMs`. Annotations of hidden parent symbols (matched by `attributes.parentId` to `attributes.id`) are hidden too. |

Echelon code is read by `getEchelonCode` (see [echelon helpers](#echelon-helpers)).

### Solve pipeline

Steps (`SolveStep`) registered by other engines run in **registration order** on a debounced pass: 200 ms after the last trigger, at most one pass pending. Triggers: zoom change, view becoming stationary, graphics added or removed (batched over 100 ms), `refresh()`, `requestSolve()`, `registerSolveStep()` while enabled. With no registered steps, the pipeline does nothing. Each pass rebuilds the [SpatialIndex](#spatialindex) if the view fingerprint changed, the index is empty, or membership changed, runs the steps (each wrapped in try/catch so one failing step does not stop the others), then emits `declutter-solve-stats`.

Registered step names: `cluster`, `ladder`, `markerDisperser`, `labelPlacer`, and (if a host connects it) `viz-aggregate`.

Because steps run in registration order and a step is registered when its engine is enabled, the order equals the order of the `enable()` calls. `SymbolEngine` enables them at boot in the order cluster, label placer, ladder, disperser. Disabling and re-enabling an engine at runtime moves its step to the end. This matters for ladder and disperse: ladder tags its members with `__ladderRung` and the disperser skips tagged graphics, which only helps when the ladder step has already run in that pass. If both are used, enable the ladder before the disperser.

### Types

```ts
interface SolveContext {
  view: MapView | SceneView;
  index: SpatialIndex;
  zoom: number;
  zoomInt: number;      // Math.floor(zoom)
}
type SolveStep = (ctx: SolveContext) => void;

interface SolveStats {
  solveMs: number;
  indexSize: number;
  perStepMs: Record<string, number>;
  zoom: number;
  timestamp: number;
}

interface DeclutterOptions {            // exported type; not consumed by any engine method
  enabled?: boolean;
  annotations?: { mode?: 'off' | 'zoom' | 'minscale' | 'density'; zoomThreshold?: number; densityMinPx?: number; fadeMs?: number };
  symbols?: { hideBelow?: boolean; zoomThreshold?: number; echelonBased?: boolean; fadeMs?: number };
}
```

`DeclutterOptions` is exported but no method accepts it; the engine reads the settings tree directly.

### Methods

| Method | Signature | Behavior |
| --- | --- | --- |
| `enable` | `(): void` | Marks enabled, applies current zoom rules, schedules a solve. |
| `disable` | `(): void` | Cancels timers, clears the index, resets every symbol/annotation layer to fully visible. |
| `refresh` | `(): void` | Re-reads settings. If `declutter.enabled` is false or missing, resets to visible; otherwise marks enabled, forces an echelon re-evaluation and schedules a solve. Called by `SymbolEngine` on any `declutter.*` change other than `declutter.enabled`. |
| `onViewChanged` | `(newView: MapView \| SceneView, newLayerManager?: GraphicsLayerManager): void` | Adopts the new layer manager, marks the index dirty, re-attaches watchers, and re-applies rules if enabled. |
| `destroy` | `(): void` | Removes watchers and timers, clears steps and index, resets visibility. |
| `registerSolveStep` | `(name: string, step: SolveStep): void` | Adds or replaces a step by name (a replaced step keeps its position). Schedules a solve if enabled. |
| `unregisterSolveStep` | `(name: string): void` | Removes a step. |
| `requestSolve` | `(): void` | Schedules a pass if enabled. |
| `spatialIndex` | `get: SpatialIndex` | Index for steps that need extra queries between passes. |

### Events

| Event | Target | `detail` | When |
| --- | --- | --- | --- |
| `declutter-solve-stats` | `document` (dispatched directly on `document`) | `SolveStats` | After every completed solve pass. Public, and the supported way to observe declutter cost. |

```ts
document.addEventListener('declutter-solve-stats', (e) => {
  const s = (e as CustomEvent).detail;   // s.solveMs, s.indexSize, s.perStepMs.cluster, ...
  if (s.solveMs > 50) console.warn('declutter slow', s);
});
```

The harness `declutter.perfHud` overlay is implemented in `index.html` on top of this event; the library does not draw it. `declutter.perfHud` has no effect in a host that does not implement the HUD.

---

## ClusterEngine

Module: `Engines/Declutter/ClusterEngine` (named and default export).

```ts
new ClusterEngine(viewProvider, layerManager, declutter: DeclutterEngine)
```

| Method | Signature | Behavior |
| --- | --- | --- |
| `enable` | `(): void` | No-op if enabled. Registers solve step `cluster` and a view click handler. |
| `disable` | `(): void` | Unregisters the step, removes the click handler, restores every hidden member, clears the badge layer. |
| `refresh` | `(): void` | Requests a solve if enabled. |
| `onViewChanged` | `(view, newLayerManager?): void` | If enabled: restores members against the old manager, clears badges, adopts the new manager, re-wires click, requests a solve. |

Algorithm per pass: restore the previous pass's hidden members; if `zoom > cluster.maxZoom` fade the badge layer out and stop; otherwise sort visible index entries by priority (highest first) and flood-fill from each unprocessed seed: neighbours within `cluster.radiusPx` join, transitively. With `cluster.respectIdentity` only same-group symbols join (groups: friend = identity 2 or 3, hostile = 5, 6 or 7, neutral = 4, unknown = 0 or 1, other). Groups with fewer than `cluster.minClusterSize` members are left alone. Cluster members are hidden (`visible = false`; the prior state is restored on the next pass).

Two presentations (`cluster.promoteMode`):

| Mode | Result |
| --- | --- |
| `badge` | All members hidden; a circle in the identity color (friend `[0,51,204]`, hostile `[255,48,49]`, neutral `[0,167,80]`, unknown `[255,200,0]`, other `[120,120,120]`) with the count. Diameter is `min(60, 22 + log2(count) * 5)` px. |
| `seed` | If all members share one echelon, the highest-priority member stays visible and an "x N" text tag is placed at its upper right; other members are hidden. If echelons differ, that cluster falls back to a badge. |

Click-to-expand: clicking a badge pins its member ids so they stay visible until the user clicks blank map (which unpins all) or the view is switched between 2D and 3D. This adds a `click` handler to the view; it uses `view.hitTest`.

Tuning: see [tuning guidance](#tuning-guidance).

---

## LadderEngine

Module: `Engines/Declutter/LadderEngine` (named and default export). Constructor `(viewProvider, layerManager, declutter)`. Methods `enable()`, `disable()`, `refresh()`, `onViewChanged(view, newLayerManager?)` behave as for `ClusterEngine` (step name `ladder`; `disable()` also clears the ladder layer and restores layer elevation modes).

Active only for `ladder.minZoom <= zoom <= ladder.maxZoom`; outside that band all laddered symbols are restored. Within it, point symbols within `ladder.thresholdPx` of each other (transitively) form a stack. With `ladder.respectIdentity`, stacks are split by identity group. A stack is laddered only if it has between `ladder.minRungs` and `ladder.maxRungs` members; smaller stacks are left alone and larger ones are released to their true positions (they are cluster candidates). Rungs are ordered by priority, highest on the top rung.

| Setting | Effect |
| --- | --- |
| `layout` = `side` | Rungs offset by `sideOffsetPx` from a vertical spine; with `showTieLines` a thin perpendicular line joins spine and each rung. |
| `layout` = `center` | Rungs centered on the spine; tie-lines are not drawn. |
| `rungSpacingPx` | Vertical pixel spacing between rungs. |
| `spineColor`, `spineWidth`, `spineOpacity` | Spine style; tie-lines use 60 percent of the opacity. |
| `altitudeMode` | In a 3D `SceneView` only: rungs stack in altitude, `z = stemBaseAltitudeM + (N-1-i) * altitudeSpacingM` (i = 0 is the top rung), joined by a stem from the ground centroid to the top rung. In 2D the engine falls back to screen-space placement. |

---

## MarkerDisperser

Module: `Engines/Declutter/MarkerDisperser` (named and default export). Constructor `(viewProvider, layerManager, declutter)`; methods `enable()`, `disable()`, `refresh()`, `onViewChanged(view, newLayerManager?)` as above (step name `markerDisperser`; `disable()` restores all positions).

Active for `disperse.minZoom <= zoom <= disperse.maxZoom`. Point symbols within `disperse.thresholdPx` (transitively) form a stack of at least 2; members are placed on a circle of `disperse.radiusPx` around the stack's screen centroid, starting at the top and ordered by id for stable results. Members beyond `disperse.maxGroupSize` stay at their true position. Symbols carrying `__ladderRung` are skipped.

---

## LabelPlacer

Module: `Engines/Declutter/LabelPlacer` (named and default export). Constructor `(viewProvider, layerManager, declutter)`; methods `enable()`, `disable()`, `refresh()`, `onViewChanged(view, newLayerManager?)` as above (step name `labelPlacer`; `disable()` restores anchors and clears leader lines).

Per pass, for visible labels within the viewport plus a 50 px margin:

1. Sort by parent-symbol priority; labels beyond `labels.maxToPlace` are hidden (lowest priority first).
2. For each label try 8 positions around its anchor at distance `labels.offsetPx`, in the order NE, E, SE, N, S, NW, W, SW, taking the first that does not overlap already placed labels.
3. If none fits and `labels.abbreviateOnOverflow` is on and the text is longer than `labels.abbreviateMaxChars`, retry with the truncated text plus an ellipsis; the full text is restored when it fits again.
4. If still unplaced: hidden when `labels.hideOnOverflow` is on, otherwise placed at the first position with overlap accepted.
5. A leader line is drawn when the label is displaced by more than `labels.leaderThresholdPx`.

Label size is estimated, not measured: width `= text.length * fontSize * 0.55 + 4`, height `= fontSize * 1.3 + 4`. Collision tests use a 64 px grid.

---

## SpatialIndex

Module: `Engines/Declutter/SpatialIndex` (named export `SpatialIndex`).

```ts
interface IndexEntry {
  graphic: Graphic;
  id: string;
  x: number;          // screen px
  y: number;          // screen px
  priority: number;   // cached priorityOf(graphic)
  layerId: string;
}
new SpatialIndex(cellSize: number = 64)
```

| Member | Signature | Behavior |
| --- | --- | --- |
| `rebuild` | `(sources: Iterable<{ layerId: string; graphics: Iterable<Graphic> }>, view): void` | Clears and rebuilds in one pass. Skips graphics with no `attributes.id`, no geometry, or a failed/null `view.toScreen`. |
| `within` | `(x: number, y: number, radiusPx: number): IndexEntry[]` | Entries within the radius, exact Euclidean filter. |
| `bucketOf` | `(x: number, y: number): IndexEntry[]` | Entries in the single cell containing the point. |
| `bucketEntries` | `(): IterableIterator<[string, IndexEntry[]]>` | Every populated bucket. |
| `getById` | `(id: string): IndexEntry \| undefined` | Lookup by graphic id. |
| `isStale` | `(view): boolean` | True if the view fingerprint (zoom, extent, width, height, and for 3D camera heading and tilt) changed since the last rebuild. |
| `clear` | `(): void` | Empty the index. |
| `size` | `get: number` | Entry count. |
| `cellSizePx` | `get: number` | Cell size. |

`DeclutterEngine` uses a 64 px cell.

---

## PriorityResolver

Module: `Engines/Declutter/PriorityResolver` (named exports).

```ts
interface PriorityComponents { echelon: number; identity: number; manual: number; recency: number; total: number; }
scoreGraphic(g: Graphic, now: number = Date.now()): PriorityComponents
priorityOf(g: Graphic, now: number = Date.now()): number     // scoreGraphic(g, now).total
const PRIORITY_MAX: number                                   // 14 * 1.1 + 10 + 1
```

`total = echelon * identity + manual + recency`.

| Component | Source | Values |
| --- | --- | --- |
| `echelon` | `getEchelonCode(g)`, upper-cased | 2525D codes `"11"`..`"24"` map 1..14 (Team/Crew 1, Squad 2, Section 3, Platoon 4, Company 5, Battalion 6, Regiment/Group 7, Brigade 8, Division 9, Corps 10, Army 11, Army Group 12, Region 13, Command 14); 2525C letters `A`..`N` map 1..14; `"00"` and unknown map 0 |
| `identity` | `getIdentityCode(g)` | `0` 0.8, `1` 0.8, `2` 1.0, `3` 1.0, `4` 0.9, `5` 1.05, `6` 1.1; other 1.0 |
| `manual` | `attributes.priority ?? drawEssentials.priority` | Number, default 0. Use this to force importance |
| `recency` | `attributes.createdAt ?? drawEssentials.createdAt` (ms since epoch) | Linear from 1 (just created) to 0 over one hour; 0 if missing or older |

A host can bias declutter by setting `graphic.attributes.priority` (higher is kept longer and wins seed and label priority).

### Echelon helpers

Module `Engines/Declutter/echelon`:

```ts
getEchelonCode(g: Graphic): string     // "00" when unknown
getIdentityCode(g: Graphic): string    // single char, "" when unknown
```

`getEchelonCode` order: `drawEssentials.ECHELON` (padded to 2 digits), then `attributes.metadata.echelon` or `symbol.metadata.echelon`, then the SIDC: a 30-character SIDC uses characters 10-12 for symbol sets `03` and `10` and characters 6-8 otherwise; a 15-character (2525C) SIDC uses the character at index 11. `getIdentityCode` reads the SIDC (`drawEssentials.SIDC`, `attributes.sidc`, `attributes.SIDC`): for 15-character SIDCs the affiliation letter is mapped to `"3"` (F, A, D, M), `"6"` (H, S, J, K), `"4"` (N, L) or `""`; otherwise it returns the character at index 1.

---

## VisualizationEngine

Module: `Engines/Visualization/VisualizationEngine` (named export `VisualizationEngine`, default export the same class, private constructor). Obtain with `VisualizationEngine.getInstance()` or `symbolEngine.visualizationEngine` (`null` when `features.visualizationEngine` was not `true` at boot and has not been enabled since).

Overlays are drawn into `VisualizationOverlayLayer` (a `GraphicsLayer` inserted at index 0, below the symbol layers, `elevationInfo: relative-to-ground` offset 0). Overlays refresh with a 150 ms debounce when: the graphics count or first vertex signature of `FORCE`, `TACT_PT` or `TACT` changes; the extent changes while any overlay is enabled; or the zoom changes while aggregate mode is enabled.

### Identity classification

Overlays classify point symbols by SIDC characters 3-4 (`drawEssentials.SIDC`, else `drawEssentials.AMPLIFIER.SIDC`): `02`, `03` friendly; `05`, `06` enemy; `04` neutral. Pending (`00`), unknown (`01`) and anything else are excluded from rings, grid, hull and density. Only graphics in the current view extent expanded 1.5 times are considered.

### Options

```ts
interface VisualizationOptions {
  render: RenderOptions;
  layerEffects: LayerEffectsOptions;
  coverageRings: CoverageRingsOptions;
  forceRatioGrid: ForceRatioGridOptions;
  convexHull: ConvexHullOptions;
  extrudedFootprints: ExtrudedFootprintsOptions;
  aggregate: AggregateOptions;
}
```

Field-level defaults and meanings for everything in `Settings.json` are in the [settings reference](08-settings.md#visualization). Additional engine options that are not present in `Settings.json`:

| Option | Engine default | Meaning |
| --- | --- | --- |
| `convexHull.neutralFillColor` | `[80,200,120]` | Fill for the neutral hull. |
| `aggregate.enabled` | `false` | When zoom falls below `zoomBelow`, automatically show the hull and/or grid so force disposition remains visible when symbols are hidden by declutter. |
| `aggregate.zoomBelow` | `6` | Zoom threshold for aggregate mode. |
| `aggregate.showHull` | `true` | Include the hull in aggregate mode. |
| `aggregate.showGrid` | `false` | Include the force-ratio grid in aggregate mode. |
| `render.liftSymbolsFromGround` | none | Deprecated legacy "lift all" flag, superseded by the three per-kind lift options. |
| `convexHull.enabled` etc. | all `false` | All overlays are off unless enabled. |

Engine-only default differences from the shipped JSON: `render.symbolElevationOffset` 100 (JSON 400), `render.dropLineColor` `[40,40,40]` (JSON `[255,0,0]`), `render.dropLineWidth` 1.5 (JSON 2).

Overlay behavior:

| Overlay | Behavior |
| --- | --- |
| Coverage rings | A geodesic buffer of `radiusKm` around every friendly and every enemy point symbol; with `showOverlap`, the intersection of the union of friendly rings and the union of enemy rings is filled in `overlapColor`. |
| Force-ratio grid | Bounding box of all friendly and enemy points, padded by 15 percent (at least 5000 map units), divided into cells of `cellSizeKm * 1000` map units, capped at 20 columns and 20 rows. Each populated cell is colored by friendly:enemy ratio: `favorableColor` at 1.5:1 or better (or no enemy), `unfavorableColor` at 0.67:1 or worse (or no friendlies), a blend toward `parityColor` in between; the label shows `friendly:enemy` counts. Note: cell size is computed in map units, so on Web Mercator the cells are not ground-true kilometres (the 1/cos(latitude) factor from the [geodesic rules](09-measurement-cues-mgrs.md#geodesic-rules) is not applied here). |
| Convex hull | Convex hull of each identity group's points (friendly, enemy, neutral), drawn when at least 3 points exist. |
| Extruded footprints | 3D only (skipped when `view.type === "2d"`). Extrudes tactical polygons into blocks and tactical polylines into vertical walls. `colorMode`: `identity` (friendly, enemy, neutral, unknown colors), `inherit` (the graphic's symbol color), `single` (`singleColor`). |
| Layer effects | Sets the ArcGIS `effect` string on the FORCE, TACT_PT and TACT layers when enabled; cleared on disable. The setting help states this renders only in 2D `MapView`. Effect strings use ArcGIS CSS-filter effect syntax. |

### Lifecycle

| Method | Signature | Behavior |
| --- | --- | --- |
| `getInstance` | `static (): VisualizationEngine` | Singleton. |
| `start` | `(view: MapView \| SceneView): void` | Attach, create the overlay layer and the graphics/zoom/extent watchers. |
| `enable` | `(): void` | Apply layer effects and schedule a refresh. |
| `disable` | `(): void` | Clear layer effects and the overlay layer. Tracked sectors stay in memory and reappear on the next `enable()` refresh. |
| `toggle` | `(): boolean` | Flip; returns new `isEnabled`. |
| `isEnabled` | `get: boolean` | State. |
| `onViewChanged` | `(view: MapView \| SceneView): void` | Re-adds the overlay layer to the new map if needed, re-creates watchers, refreshes if enabled. Sector symbols are rebuilt for the current view type so flat and extruded forms swap on 2D/3D switch. |
| `refresh` | `(): void` | Schedule an overlay refresh (for example after bulk geometry edits). |
| `setOptions` | `(options: Partial<VisualizationOptions>): void` | Shallow-merges each provided group (`Object.assign`) into the current options. If `render` is provided and a scene view has been captured, re-applies render settings. If enabled, re-applies layer effects and refreshes. |
| `connectDeclutter` | `(declutter: DeclutterEngine): void` | Registers a solve step `viz-aggregate` that only triggers an overlay refresh after each declutter pass. `SymbolEngine` does not call this. `disconnectDeclutter()` removes it. Optional. |
| `disconnectDeclutter` | `(): void` | Unregisters the step. |

### Render settings (3D)

#### applyRenderSettings(sceneView: SceneView, settings: any = {}): void

Applies scene quality, shadow, atmosphere and symbol-lift settings to a `SceneView`. It is independent of `features.visualizationEngine` and of `enable()`; it works as soon as it is called, and it caches the scene view so later `setOptions({ render })` calls re-apply automatically.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sceneView` | `SceneView` | required | Target scene. No-op if falsy. |
| `settings` | `any` | `{}` | Either the full settings tree (uses `settings.visualization.render`), or a bare render block (`settings.render`), or the render object itself. |

Effects: `highQuality3D` sets `qualityProfile = 'high'` (initial value restored when off); `disableSceneShadows` turns off direct shadows and ambient occlusion (initial values restored when off); `highAtmosphereQuality` sets atmosphere quality high (initial restored when off); the three lift flags raise force points, tactical points and lines/areas by `symbolElevationOffset` meters; `forcePointDropLines` draws vertical lines from lifted force points to ground using `dropLineColor`, `dropLineWidth`, `dropLineOpacity`. The initial scene state is captured the first time a given scene view is passed.

The host must call this for render settings to reach the scene. The test harness does so at startup and on each switch to 3D (`src/main.ts`), and exposes `window.applyRenderSettings`, which `index.html` calls when a `visualization.render.*` setting changes. A host that only forwards changes to `symbolEngine.onSettingChanged` gets `setOptions` on the engine (if it exists), which re-applies render settings only after `applyRenderSettings` has captured a scene view at least once.

```ts
import VisualizationEngine from '@lib/Engines/Visualization/VisualizationEngine';

VisualizationEngine.getInstance().applyRenderSettings(sceneView, symbolEngine.settings);

window.addEventListener('settingsChanged', (e) => {
  const { path, value } = (e as CustomEvent).detail;
  symbolEngine.onSettingChanged(path, value);
  if (path[0] === 'visualization' && path[1] === 'render') {
    VisualizationEngine.getInstance().applyRenderSettings(sceneView, symbolEngine.settings);
  }
});
```

### Transient overlays

A refresh (`_refresh`, run after the triggers listed above, after `setOptions` and after `refresh()`) calls `removeAll()` on the overlay layer and then redraws only the option-driven overlays (rings, grid, hull, extruded footprints) and the tracked sectors. Threat fans, MGRS density cells and the sector preview are not redrawn. While the engine is enabled, they disappear at the next refresh, for example when a symbol is added, moved or deleted on the FORCE, TACT_PT or TACT layer. Treat them as snapshots: call `showThreatFan` / `showMgrsDensity` again after changes if you need them to persist. Tracked sectors are not affected.

### Threat fan

#### showThreatFan(graphic: Graphic, speedKmh: number, timeHoursIntervals: number[]): void

Draws time-distance rings centered on a point graphic. Each interval `h` yields a geodesic circle of radius `speedKmh * h` km. Outermost rings are drawn first. Replaces any previous threat fan. Colors come from a fixed 3-entry palette (yellow, orange, red) indexed by position in `timeHoursIntervals`, reusing the last entry beyond three. Intervals giving a radius of 0 or less are skipped. No-op if the graphic is not a point or the engine has no layer.

#### clearThreatFan(): void

Removes threat-fan graphics.

```ts
symbolEngine.visualizationEngine?.showThreatFan(pointGraphic, 40, [0.5, 1, 2]);   // 20, 40, 80 km rings
```

### Threat sectors

Geodesic azimuth-bounded wedges tracked as editable instances; the sweep is clockwise from `azStartDeg` to `azEndDeg` (degrees from true north).

```ts
interface SectorOptions {
  rangeKm: number;
  azStartDeg: number;
  azEndDeg: number;
  color?: [number, number, number];
  fillOpacity?: number;
  opacity?: number;               // alias for fillOpacity
  outlineOpacity?: number;
  outlineWidth?: number;
  extrudeHeightM?: number;        // metres; 3D only, 0 = flat
  label?: string;
}

interface SectorListItem {
  id: string; label: string; rangeKm: number; azStartDeg: number; azEndDeg: number;
  color: [number, number, number]; fillOpacity: number; outlineOpacity: number;
  outlineWidth: number; extrudeHeightM: number;
}
```

| Method | Signature | Behavior |
| --- | --- | --- |
| `createSector` | `(center: Point \| Graphic, opts: SectorOptions): string` | Creates a sector. Returns its id (`sector_<n>`), or `""` if there is no overlay layer, the center is not a point, `rangeKm` is not greater than 0, or start and end azimuth are equal modulo 360 (degenerate). Uses `center.longitude` and `center.latitude`. Defaults come from the sector defaults below; the label defaults to `Sector <n>`. |
| `showSector` | `(center: Point \| Graphic, opts: { rangeKm, azStartDeg, azEndDeg, color?, opacity? }): void` | Backwards-compatible wrapper for `createSector`. |
| `updateSector` | `(id: string, patch: Partial<Omit<SectorListItem, "id">>): void` | Patches geometry and/or appearance in place. `rangeKm` changes apply only if greater than 0. Unknown id is a no-op. |
| `removeSector` | `(id: string): void` | Removes one sector. |
| `listSectors` | `(): SectorListItem[]` | Snapshot copy. |
| `getSectorDefaults` | `(): { color, fillOpacity, outlineOpacity, outlineWidth, extrudeHeightM }` | Current defaults for new sectors: color `[220,50,50]`, fill opacity 0.30, outline opacity 0.85, outline width 1.5, extrusion 0. |
| `setSectorDefaults` | `(patch): void` | Updates those defaults in memory only. |
| `setSectorsChangedHandler` | `(cb: (() => void) \| null): void` | One callback fired whenever the sector set changes. Errors in it are swallowed. |
| `clearSectors` | `(): void` | Removes all sectors and the live preview. |
| `renderSectorPreview` | `(pt: Point, rangeKm: number, azStartDeg: number, azEndDeg: number): void` | Draws the transient dashed preview wedge used by `SectorDrawTool`. |
| `clearSectorPreview` | `(): void` | Removes the preview. |

`SymbolEngine` pass-throughs for the interactive tools: `beginSectorDraw(center?: Point | Graphic): void` (click center, then range and start edge, then sweep to the end edge; Escape or right-click cancels), `openSectorPanel(): void`, `closeSectorPanel(): void`, `clearSectors(): void`. These exist only when the visualization engine was created.

```ts
const id = symbolEngine.visualizationEngine?.createSector(unitGraphic, {
  rangeKm: 12, azStartDeg: 300, azEndDeg: 60, label: 'Engagement area', extrudeHeightM: 500,
});
```

The sector geometry is built in WGS84 (`wkid 4326`) polygons from the geodesic ring builder in `sectorGeometry.ts`, independent of the view's spatial reference.

### MGRS density heat map

#### showMgrsDensity(opts?: { precision?: 0 | 1 | 2; mode?: "ratio" | "count" }): void

Shades UTM-aligned cells by the symbols they contain.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `opts.precision` | `0 \| 1 \| 2` | `1` | Cell size: 0 = 100 km, 1 = 10 km, 2 = 1 km. |
| `opts.mode` | `"ratio" \| "count"` | `"ratio"` | `ratio`: color by friendly:hostile ratio using the force-ratio palette (mixed cells shown as contested). `count`: single amber hue whose opacity scales with density. In both, opacity scales with the cell's count relative to the busiest cell. |

Does nothing if there are no friendly or enemy point symbols in the padded view extent, or no overlay layer. Replaces any previous density layer. `clearMgrsDensity(): void` removes it. `SymbolEngine` exposes both as `showMgrsDensity(opts?)` and `clearMgrsDensity()`. The density heat map does not require the MGRS grid engine to be enabled. Density cells are computed once when called and are not recomputed when symbols move. They are also removed by the next overlay refresh while the engine is enabled (see [Transient overlays](#transient-overlays)).

```ts
symbolEngine.showMgrsDensity({ precision: 2, mode: 'count' });
symbolEngine.clearMgrsDensity();
```

### Visualization settings routing

`SymbolEngine.onSettingChanged` handles `features.visualizationEngine` (enable/disable; create if missing when set to true) and, for any `visualization.*` path, calls `setOptions` with the entire `visualization` block, if the engine exists. See [08](08-settings.md#what-onsettingchanged-does-per-path).

---

## Tuning guidance

The values below are guidance derived from how the code behaves; validate them on your data with the `declutter-solve-stats` event.

**Enable in the right order.** Set `declutter.enabled` first; the sub-engines only run their solve steps while the main engine is enabled. Enable `ladder` before `disperse` if you use both.

**Design non-overlapping zoom bands.** Cluster is active up to `cluster.maxZoom` (shipped 14). Disperse and ladder are active from `minZoom` (shipped 11) up to their `maxZoom` (18 and 20). With the shipped values, zooms 11 to 14 have both active; the cluster step runs first and hides its members, and disperse/ladder skip hidden graphics, so only symbols left unclustered are fanned or laddered. For predictable behavior choose `cluster.maxZoom` below `disperse.minZoom` / `ladder.minZoom`, so each zoom range has one strategy.

**Pick a strategy by scene.**

| Situation | Suggested setting |
| --- | --- |
| Overview zooms with hundreds of symbols | Cluster with `respectIdentity` on; `radiusPx` 60 to 100; `minClusterSize` 3 or more to avoid pairing symbols. |
| Command posts and stacked units at one coordinate at high zoom | Disperse (`thresholdPx` about 12, `radiusPx` about 18) for small stacks; Ladder for stacks with a clear priority order (`minRungs` 2, `maxRungs` about 15). |
| 3D scenes where symbols share a location | Ladder with `altitudeMode` on: `altitudeSpacingM` should exceed the rendered symbol height at the working zoom, and `stemBaseAltitudeM` lifts the whole stack above terrain. |
| Cluttered labels | LabelPlacer with `abbreviateOnOverflow` on and `hideOnOverflow` off for briefings; turn `hideOnOverflow` on when overlap is worse than a missing label. Lower `maxToPlace` to bound the cost. |
| Only labels are cluttered | Use annotation mode `zoom` with a threshold about 2 to 3 levels above `symbols.zoomThreshold`, or `density` with `densityMinPx` 30 to 60 (note density is not priority-based). |
| Force disposition must survive zooming out | Enable `visualization.aggregate` (hull and/or grid below `zoomBelow`) together with `symbols.hideBelow` or echelon filtering. |

**Cost control.** Each pass is O(N) for the index rebuild plus the steps, once per 200 ms debounce after movement stops (the pass runs on view `stationary` and zoom changes, not per pointer move). The main knobs are `cluster.radiusPx` (larger means more neighbour work per seed), `labels.maxToPlace`, and the number of graphics with ids. Turn on the harness perf HUD or subscribe to `declutter-solve-stats` and look at `perStepMs` to find the expensive step.

**Symbols that must never move.** If a workflow depends on exact `graphic.geometry` (export, measurement of existing graphics, selection by coordinates), keep disperse and ladder off or outside their zoom bands, since both move point geometry while active.

**Priority.** Set `graphic.attributes.priority` (higher wins) for symbols that must survive clustering seeds, ladder top rungs and label budgets. Echelon and identity already contribute; hostile symbols are weighted 1.1 and command-level echelons 14.

---

## Verification notes

- Facts in this document come from `Engines/Declutter/*.ts`, `Engines/Visualization/VisualizationEngine.ts`, `SectorDrawTool.ts`, `SymbolEngine.ts`, `src/main.ts` and `index.html`.
- Whether a `SceneView` exposes numeric `view.zoom` (all declutter zoom logic depends on it, and `DeclutterEngine` does nothing when it is `undefined`) was not verified from the ArcGIS SDK. Test declutter in 3D on your SDK version.
- The behavior of `SerializationEngine` while disperse or ladder is active is inferred from the absence of references to the `__dsp*` / `__lad*` attributes outside `Engines/Declutter/`; it was not tested.
- The internal element structure of the sector panel and compass panel is not documented as public API.
