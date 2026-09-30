# 09 - Measurement, proximity, drawing cues and MGRS

This document covers four map-overlay engines that work while the user draws or that overlay a grid: `MeasurementEngine`, `ProximityEngine`, `DrawingCueEngine` (with its child `MagneticCompass`) and `MGRSEngine`. It also states the geodesic rules that all metric geometry in the library follows.

Related documents: [README](README.md) | [SymbolEngine API](02-symbol-engine-api.md) | [Drawing and events](03-drawing-and-events.md) | [Support classes (GeoTools)](04-support-classes.md) | [Settings](08-settings.md) | [Declutter and visualization](10-declutter-visualization.md)

| Engine | Purpose | Access from the host | Boot gate (`Settings.json`) |
| --- | --- | --- | --- |
| [MeasurementEngine](#measurementengine) | Live segment length, bearing, total length, area, bounding-box size while drawing; one-shot measurement of an existing graphic | `symbolEngine.measurementEngine` (may be `undefined`), `await symbolEngine.toggleMeasurement()` | `features.measurementEngine`, loaded unless exactly `false`; not enabled until toggled |
| [ProximityEngine](#proximityengine) | Snap indicator (dot, line, distance label) to the nearest existing symbol while drawing | `symbolEngine.proximityEngine` (may be `null`) | `features.proximityEngine`, created and enabled unless exactly `false` |
| [DrawingCueEngine](#drawingcueengine) | Rubber band, cursor coordinates, angular guides, distance rings, nearby highlight, close-polygon cue, magnetic compass | `symbolEngine.drawingCueEngine` (may be `null`) | `features.drawingCues`, created and enabled unless exactly `false` |
| [MGRSEngine](#mgrsengine) | MGRS/UTM grid overlay (GZD, 100 km, 10 km, 1 km) | `symbolEngine.mgrsEngine` (may be `null`) | `features.mgrsEngine`, created and enabled unless exactly `false` |

All four are module-level singletons obtained with `Engine.getInstance()`. `SymbolEngine` creates and drives them; a host normally uses the `symbolEngine.*` accessors and does not construct them. Because they are singletons, two `SymbolEngine` instances in one page share one measurement/proximity/cue/MGRS engine, and the engine is attached to whichever view was passed to `start()` / `onViewChanged()` last. Multi-map hosts should keep this in mind.

The shipped `Settings.json` sets `features.measurementEngine`, `features.proximityEngine`, `features.drawingCues` and `features.mgrsEngine` to `false`. Because Proximity and DrawingCue are skipped at boot when `false` and are **not** lazily created by `onSettingChanged`, a host that wants them must set the flag to `true` before constructing `SymbolEngine` (see the persistence section in [08](08-settings.md#persistence)). Measurement and MGRS are created on demand.

---

## How SymbolEngine drives these engines

`SymbolEngine.setupGlobalEventListener()` attaches `document`-level listeners for the draw events emitted by symbol classes (see [03](03-drawing-and-events.md)). Only events born in the engine's own view container are handled. The wiring is:

| Draw event | Calls |
| --- | --- |
| `onDrawProgress` | `proximityEngine.activate()`, `drawingCueEngine.activate([...SYMBOL_LAYER_IDS])`; then, if `detail.currentGeometry` and `detail.currentDrawEssentials.CTRL_PTS` exist: `measurementEngine.updateSegments(currentGeometry, CTRL_PTS)` and `drawingCueEngine.updateFromProgress(currentGeometry, CTRL_PTS)` |
| `onDrawClick` | `measurementEngine.addSegment(detail.currentPts)` |
| `onDrawEnd` | `measurementEngine.wrapUp()`, `proximityEngine.deactivate()`, `drawingCueEngine.deactivate()` (skipped when a draw-lifecycle suppression counter is set) |
| `onViewChanged(newView)` | Each engine's `onViewChanged(newView)` |
| `destroy()` | `measurementEngine.destroy()`, `proximityEngine.disable()`, `drawingCueEngine.disable()`, `mgrsEngine.destroy()` |

Proximity snap targets and cue highlight candidates are the symbol layers listed in `GraphicsLayerManager.SYMBOL_LAYER_IDS`.

Engine-ready events are dispatched on the view container by `SymbolEngine` (bubbling, so catchable on `document`): `measurementEngineReady`, `proximityEngineReady`, `drawingCueEngineReady`, `mgrsEngineReady`, `visualizationEngineReady`, each with `detail: { engine }`.

---

## Geodesic rules

Live views usually report Web Mercator as wkid `102100` (with `latestWkid` 3857). Testing `wkid === 3857` alone silently falls back to planar math, which overstates distances by roughly 15 to 18 percent at 30 to 35 degrees latitude. All metric work must follow these rules (source: `Support/GeoTools.ts`, see [04](04-support-classes.md)):

| Rule | Use |
| --- | --- |
| Decide "can I use geodesic operators" | `GeoTools.supportsGeodesic(sr)`: true for `isWGS84`, `isWebMercator`, or wkid 4326, 3857, 102100, 102113, 3785 (falls back to `latestWkid` when `wkid` is absent). False for null. |
| Decide "is this Web Mercator" | `GeoTools.isWebMercatorSR(sr)`: wkid 3857, 102100, 102113, 3785 or `isWebMercator`. |
| Convert ground meters to map units at a point | `GeoTools.metersToMapUnits(meters, point)`: Web Mercator divides by cos(latitude); WGS84 uses `meters / 111320`; any other SR is assumed metre-based and returned unchanged. |
| Convert map units to ground meters | `GeoTools.mapUnitsToMeters(mapUnits, point)`: inverse of the above. |
| Latitude of a point | `GeoTools.latitudeOf(point)`. |
| Ground-true circle | `GeoTools.geodesicCircle(center, radiusM): Polygon | null` (geodesic buffer, metres). |
| Ground-true sector | `GeoTools.geodesicSector(center, radiusM, startAzDeg, endAzDeg, stepDeg = 2): Polygon`, azimuths clockwise from true north; equal azimuths give a full circle. |

Per engine:

| Engine | Geodesic behavior |
| --- | --- |
| MeasurementEngine | Uses `GeoTools.supportsGeodesic` on the view's spatial reference: `geodesicLength` / `geodesicArea` when true, `planarLength` / `planarArea` otherwise. For other spatial references it logs one `console.warn` per session and uses planar math. |
| DrawingCueEngine | Uses `GeoTools.supportsGeodesic`: rings, highlight rings use `geodesicBuffer` when true, planar `buffer` otherwise. Kilometre-to-map-unit conversions use `GeoTools.metersToMapUnits` / `mapUnitsToMeters`. The coordinate readout converts Web Mercator (any variant via `isWebMercatorSR`) to lat/lon. |
| ProximityEngine | Does **not** use `GeoTools`. It treats wkid 4326, 3857 and 102100 as geodesic (great-circle distance) and everything else as planar. Wkids 102113 and 3785 are not recognized here. |
| MGRSEngine | Treats wkid 102100 and 3857 as Web Mercator (converted to WGS84 to build the grid); any other spatial reference is assumed to already be lon/lat. Wkids 102113 and 3785 are not recognized here. |
| VisualizationEngine | See [10](10-declutter-visualization.md). |

Planar fallback on a non-Web-Mercator, non-WGS84 projected view is inaccurate over long distances. The engines do not reproject.

---

## 2D and 3D differences

| Aspect | 2D (`MapView`) | 3D (`SceneView`) |
| --- | --- | --- |
| Measurement | Distances are ground (geodesic) lengths of the drawn geometry. | Same math. With `measurement.slantRange = true`, the vertical delta between points that carry a `z` is included (`sqrt(ground^2 + dz^2)`); a missing `z` counts as 0. |
| Proximity snap radius in px | Compared using `MapView.resolution` (map units per pixel). | `SceneView` has no linear `resolution`; the engine falls back to `view.toScreen()` for the pixel test and approximates resolution from `view.extent.width / view.width` for candidate culling. `toMap` may return null (for example over sky); that frame clears the indicator. |
| DrawingCue layer | `GraphicsLayer` `DrawingCueLayer` with `elevationInfo: on-the-ground`. | Same, so rings and guides drape on terrain. |
| MagneticCompass | Picture marker symbols; needle counter-rotates with `view.rotation`. | `PointSymbol3D` icon symbols; needle correction is 0 and the widget shows `camera.heading`. Sector extrusion (`extrudeHeightM`) applies only in 3D. |
| MGRS | Grid rebuilt when the view becomes stationary. Sub-grid levels are gated by `view.zoom`. | The code reads `view.zoom` and falls back to 5 when it is undefined. Whether a `SceneView` exposes a numeric `zoom` was not verified in this source. If it does not, the fallback of 5 is below every sub-grid threshold, so with `autoZoom` on only the GZD lines appear. Set `mgrs.autoZoom = false` to make every enabled level eligible regardless of zoom. |
| Layer creation | `MGRSGridLayer` and `measurementGraphicsLayer` are added to the view's map. | Same. `onViewChanged` removes the layer from the old map and creates it on the new one. |

`SymbolEngine.onViewChanged(newView)` calls every engine's `onViewChanged`. Do not call the sub-engines' `onViewChanged` directly unless you manage them without `SymbolEngine`.

---

## MeasurementEngine

Module: `Engines/MeasurementEngine` (default export `MeasurementEngine`, private constructor). Obtain with `MeasurementEngine.getInstance()` or `symbolEngine.measurementEngine`.

Graphics layer id: `measurementGraphicsLayer` (created in the view's map by `start()`).

### Types

```ts
type DistanceUnit = "feet" | "miles" | "kilometers" | "nautical-miles" | "meters" | "yards";
type AreaUnit =
  | "square-miles" | "acres" | "square-kilometers" | "hectares"
  | "square-meters" | "square-feet" | "square-yards";
type BearingFormat = "decimal" | "mils" | "quadrant";

interface MeasurementOptions {
  dist_unit?: DistanceUnit;
  area_unit?: AreaUnit;
  font_size?: number;
  font_color?: [number, number, number];
  font_opacity?: number;
  line_color?: [number, number, number];
  line_width?: number;
  line_opacity?: number;
  show_bng?: boolean;
  show_height?: boolean;
  show_width?: boolean;
  show_area?: boolean;
  show_total?: boolean;
  show_segment?: boolean;
  show_extent?: boolean;
  show_line?: boolean;
  show_last_seg_only?: boolean;
  slant_range?: boolean;
  magnetic_declination?: number;
  speed_kmh?: number;
  bearing_format?: BearingFormat;
  auto_unit?: boolean;
  preserve_labels_on_complete?: boolean;
  road_eta?: boolean;
}

interface MeasurementSnapshot {
  segmentLength: string;
  totalLength: string;
  area: string;
  bearing: string;
  trueAzimuth?: number;
  magneticAzimuth?: number;
  gridAzimuth?: number;
  height: string;
  width: string;
  unit: DistanceUnit;
  areaUnit: AreaUnit;
  roadInfo?: string;
}

interface MeasurementHint {
  message: string;
  phase: "idle" | "drawing" | "segment" | "complete";
}
```

Public fields: `readonly distanceUnits: Array<{ unit: DistanceUnit; abbr: string }>` and `readonly areaUnits: Array<{ unit: AreaUnit; abbr: string }>` (abbreviations: ft `'`, mi, km, nm, m, yd; sq mi, ac, sq km, ha, sq m, sq ft, sq yd). `get isEnabled(): boolean`.

### Option defaults inside the engine

The engine's own defaults apply until `setOptions` is called. `SymbolEngine` calls `setOptions` from the `measurement` settings block when it loads the engine, so the shipped `Settings.json` values take effect in practice.

| Option | Engine default | Shipped `Settings.json` value |
| --- | --- | --- |
| `dist_unit` | `"miles"` | `"kilometers"` |
| `area_unit` | `"square-miles"` | `"square-kilometers"` |
| `font_size` | `13` | `12` |
| `font_color` | `[255,255,255]` | `[0,80,200]` |
| `font_opacity` | `1` | `1` |
| `line_color` | `[0,255,0]` | `[0,255,0]` |
| `line_width` | `2` | `2` |
| `line_opacity` | `0.5` | `0.5` |
| `show_bng`, `show_height`, `show_width`, `show_area`, `show_total`, `show_segment`, `show_extent`, `show_line` | all `true` | all `true` |
| `show_last_seg_only` | `false` | `false` |
| `slant_range` | `false` | `false` |
| `magnetic_declination` | `0` | `0` |
| `speed_kmh` | `0` (no ETA text) | `5.0` |
| `bearing_format` | `"decimal"` | `"decimal"` |
| `auto_unit` | `false` | `false` |
| `preserve_labels_on_complete` | `false` | `false` |
| `road_eta` | `false` | `false` |

### Settings mapping

`onSettingChanged(['measurement', key], value)` re-applies the whole `measurement` block (only if the engine is loaded):

| `measurement.*` key | `MeasurementOptions` field |
| --- | --- |
| `distUnit` | `dist_unit` |
| `areaUnit` | `area_unit` |
| `fontSize` | `font_size` |
| `fontColor` | `font_color` |
| `fontOpacity` | `font_opacity` |
| `lineColor` | `line_color` |
| `lineWidth` | `line_width` |
| `lineOpacity` | `line_opacity` |
| `showBng` | `show_bng` |
| `showHeight` | `show_height` |
| `showWidth` | `show_width` |
| `showArea` | `show_area` |
| `showTotal` | `show_total` |
| `showSegment` | `show_segment` |
| `showExtent` | `show_extent` |
| `showLine` | `show_line` |
| `showLastSegOnly` | `show_last_seg_only` |
| `slantRange` | `slant_range` |
| `magneticDeclination` | `magnetic_declination` |
| `speedKmh` | `speed_kmh` |
| `bearingFormat` | `bearing_format` |
| `autoUnit` | `auto_unit` |
| `preserveOnComplete` | `preserve_labels_on_complete` |
| `roadEta` | `road_eta` |

The `features.measurementEngine` key enables or disables the engine (lazy-loading it if needed).

### Lifecycle methods

#### getInstance(): MeasurementEngine

Static. Returns the singleton.

#### start(view: MapView | SceneView): void

Attaches to a view, resolves geodesic mode from the view's spatial reference, and creates or reuses `measurementGraphicsLayer`. `SymbolEngine` calls this when it loads the engine.

#### enable(): void / disable(): void / toggle(): boolean

`enable()` sets the enabled flag, dispatches `measurement-state-change` and `measurement-hint` (phase `idle`), and logs to `EngineLogger`. `disable()` clears the layer and graphic handles and dispatches `measurement-state-change` and `measurement-hint`. `toggle()` flips the state and returns the new `isEnabled`. All draw-feeding methods are no-ops while disabled.

Prefer `await symbolEngine.toggleMeasurement()` when the engine may not be loaded yet.

#### onViewChanged(view: MapView | SceneView): void

Calls `wrapUp()`, removes the layer from the previous map, and calls `start(view)`.

#### destroy(): void

Cancels pending updates, clears and removes the layer from the map, sets disabled, and drops the view reference. `SymbolEngine.destroy()` calls it.

### Options methods

#### setOptions(options: MeasurementOptions): void

Merges only the fields that are not `undefined`. If `show_last_seg_only` is true while `show_segment` is false, `show_segment` is forced on. Changing `font_size`, `font_color` or `font_opacity` rebuilds the cached label style. Existing labels on the map are not restyled; new labels use the new style.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `options` | `MeasurementOptions` | required | Partial set of options (see table above). |

```ts
symbolEngine.measurementEngine?.setOptions({ dist_unit: 'nautical-miles', bearing_format: 'mils' });
```

#### getOptions(): Required&lt;MeasurementOptions&gt;

Returns the current values of every option.

### Draw-feed methods (called by SymbolEngine)

A host that drives drawing itself (headless use) may call these; a host using `SymbolEngine` should not.

#### addSegment(ctrlPts: Point[]): void

Call when a new control point is committed. Creates the placeholder segment label and, for the first point, the empty overlay graphics. Emits `measurement-hint` (phase `drawing` for the first point, `segment` afterwards with a running total).

#### updateSegments(geom: Geometry, ctrlPts: Point[], isPassive = false): void

Call on every draw-progress event. Ignored unless `geom` is a polyline or polygon and `ctrlPts.length >= 2`. Work is coalesced to one update per animation frame. `isPassive = true` (edit mode) creates a fresh segment graphic each time. Emits `measurement-update`.

Behavior worth knowing: during interactive drawing the live **area** label uses the polygon of the geometry's bounding box, not the drawn ring. `measureGraphic()` uses the actual rings.

#### updateAllSegments(geom: Geometry, ctrlPts: Point[], counter: number): void

Multi-segment editing variant. Ignored for `counter < 1` or non-line/polygon geometry.

#### wrapUp(firstPts?: Point[]): void

Call when drawing finishes or is cancelled. Removes all overlay graphics and emits an empty `measurement-update`, then `measurement-hint` (phase `complete`). If `preserve_labels_on_complete` is true and `firstPts` is empty, the labels are kept on the map. If `firstPts` is non-empty (continuous drawing), it re-arms with `addSegment(firstPts)`.

### Query methods

#### measureGraphic(graphic: Graphic): MeasurementSnapshot | null

Measures an existing graphic: bounding-box height and width; area from the polygon rings (polygons only); total length (polyline length, or polygon perimeter). Emits `measurement-update`. Returns `null` if the engine has no view or the geometry has no extent. If `road_eta` is on and the geometry is a polyline, a road-network enrichment runs asynchronously and re-emits the snapshot with `roadInfo`. The context menu item "Measure This Symbol" calls this and additionally dispatches `measurement-graphic-measured` (see events).

#### getStatus(): { isEnabled: boolean; unit: DistanceUnit; areaUnit: AreaUnit; isGeodesic: boolean; activeGraphics: number }

State snapshot for indicators.

#### getFormattedSnapshot(): string

Multi-line text of the last emitted snapshot (`Segment:`, `Bearing:`, `Total:`, `Height:`, `Width:`, `Area:` lines that have values). Returns `""` if nothing has been measured. Used by the harness "Copy" button.

### Value formatting

- Distances: whole numbers for meters, feet, yards; two decimals below 10 and one decimal at or above 10 for other units.
- `auto_unit`: `miles`/`feet` pick miles from 1609.34 m; `yards` pick miles from 1609.34 m; `meters`/`kilometers` pick km from 1000 m; `nautical-miles` stays as is.
- ETA: when `speed_kmh > 0`, total-length text is suffixed ` · Hh Mm @ S km/h`.
- Bearing: measured clockwise from north in map coordinates. True and grid azimuth are the same value (no convergence correction). Magnetic azimuth is `true - magnetic_declination`. The label uses magnetic with suffix `M` when the declination is non-zero, otherwise true with suffix `T`. Formats: `decimal` "045°T", `mils` "800 mil T" (6400 mils per circle), `quadrant` "N45°0'0"E".

### Events

All are dispatched on `document` and bubble.

| Event | `detail` | When |
| --- | --- | --- |
| `measurement-update` | `MeasurementSnapshot` (partial; always includes `unit` and `areaUnit`) | Each label update, `measureGraphic`, `wrapUp` (empty snapshot), road enrichment |
| `measurement-state-change` | `{ state: "enabled" \| "disabled", isEnabled: boolean }` | `enable()` / `disable()` |
| `measurement-hint` | `MeasurementHint` | Guidance at key drawing moments |
| `measurement-graphic-measured` | `{ ...MeasurementSnapshot, screenX: number, screenY: number }` | Dispatched by `ContextMenuManager`, not the engine, after "Measure This Symbol" |

```ts
document.addEventListener('measurement-update', (e) => {
  const d = (e as CustomEvent).detail;   // d.segmentLength, d.totalLength, d.bearing, d.area, ...
});
```

Harness usage (`src/main.ts`): the M key calls `symbolEngine.toggleMeasurement()`; the unit buttons call `symbolEngine.measurementEngine?.setOptions({ dist_unit, area_unit })`; the panel listens to all four events.

---

## ProximityEngine

Module: `Engines/ProximityEngine` (default export `ProximityEngine`, private constructor). Obtain with `ProximityEngine.getInstance()` or `symbolEngine.proximityEngine`.

While a draw is active the engine tracks the pointer and shows a dot at the nearest point on any existing graphic in the target layers, a dashed connector line from the cursor to that point, and a distance label. The engine draws the indicator and emits events only; it does not move the vertex being drawn. (The stylus subsystem consumes it for snapping, see [12](12-briefing-collab-stylus.md).) Holding **Alt** bypasses snapping for the current draw; the bypass is cleared on window blur or when the page becomes hidden.

Graphics layer id: `ProximityGraphicsLayer`.

### Types

```ts
type ProximityDistanceUnit = 'feet' | 'miles' | 'kilometers' | 'nautical-miles' | 'meters' | 'yards';
type ProximityHintPhase = 'idle' | 'active' | 'snapped' | 'no-targets';
interface ProximityHint { message: string; phase: ProximityHintPhase; }

interface ProximityOptions {
  nearestVertex?: boolean;
  nearestCoordinate?: boolean;
  showDistance?: boolean;
  showDirection?: boolean;              // engine option; not present in Settings.json
  distanceUnit?: ProximityDistanceUnit;
  snapRadiusPx?: number;
  lineColor?: [number, number, number];
  lineOpacity?: number;
  lineWidth?: number;
  markerColor?: [number, number, number];
  markerSize?: number;
  fontSize?: number;
  fontColor?: [number, number, number];
}
```

Engine defaults before options are applied: `nearestVertex` true, `nearestCoordinate` true, `showDistance` true, `showDirection` true, `distanceUnit` `'meters'`, `snapRadiusPx` 0, line `[0,120,255]` 0.7 opacity width 1.5, marker `[0,120,255]` size 10, font size 12 color `[255,255,255]`. `SymbolEngine` then applies `Settings.json` (`proximity.*`), so the shipped `distanceUnit` is `'miles'`, `fontSize` 11, `fontColor` `[0,80,200]`.

Snap semantics: for point geometries the point itself is the candidate when either `nearestVertex` or `nearestCoordinate` is true. For lines and polygons, `nearestCoordinate` (closest point anywhere on the geometry) takes precedence; `nearestVertex` is used only when `nearestCoordinate` is false. `snapRadiusPx = 0` means no pixel limit (candidates are still culled to about 1.5 view extents).

### Methods

| Method | Signature | Behavior |
| --- | --- | --- |
| `getInstance` | `static (): ProximityEngine` | Singleton. |
| `isEnabled` | `get: boolean` | Master state. |
| `isActive` | `get: boolean` | True while a draw session is being tracked. |
| `start` | `(view: MapView \| SceneView, targetLayerIds: string[], options?: ProximityOptions): void` | Attach to a view and set target layer ids; creates the layer; applies `options`. `SymbolEngine` passes `[...SYMBOL_LAYER_IDS]`. |
| `enable` | `(): void` | No-op if already enabled. Emits `proximity-state-change` and a hint. |
| `disable` | `(): void` | No-op if already disabled. Deactivates and emits `proximity-state-change` and a hint. |
| `toggle` | `(): boolean` | Flip; returns new `isEnabled`. |
| `activate` | `(): void` | Begin tracking (idempotent). Requires enabled and a view. Snapshots the target-layer graphics at that moment, so graphics added during the draw, including the one being drawn, are not snap targets. Attaches capture-phase `pointermove`, `keydown`, `keyup` on `window`. |
| `refreshCandidates` | `(): void` | Re-snapshot targets mid-draw (for example after a paste). No-op unless active. |
| `deactivate` | `(): void` | Stop tracking, remove listeners, hide the indicator. Emits an `idle` hint. |
| `onViewChanged` | `(view: MapView \| SceneView): void` | Deactivate, re-attach to the new view, recreate the layer. |
| `setOptions` | `(opts: ProximityOptions): void` | Merge defined fields. Does not refresh existing indicator symbols. |
| `updateConfig` | `(config: Partial<ProximityOptions>): void` | Same merge; if active and enabled it also restyles the live indicator graphics in place. This is what `onSettingChanged` uses. |
| `getStatus` | `(): { isEnabled, isActive, unit, isGeodesic, targetLayers, activeGraphics, snapRadiusPx }` | State snapshot. |

Settings mapping: `onSettingChanged(['proximity', key], value)` calls `updateConfig({ [key]: value })` for keys `nearestVertex`, `nearestCoordinate`, `showDistance`, `distanceUnit`, `snapRadiusPx`, `lineColor`, `lineOpacity`, `lineWidth`, `markerColor`, `markerSize`, `fontSize`, `fontColor`. `features.proximityEngine` calls `enable()` / `disable()` if the engine exists. The `showDirection` option is not reachable through settings.

### Events

Dispatched on `document`, bubbling.

| Event | `detail` | When |
| --- | --- | --- |
| `proximity-state-change` | `{ state: "enabled" \| "disabled", isEnabled: boolean }` | `enable()` / `disable()` |
| `proximity-snap` | `{ coordinate: { x: number, y: number }, distance: string, unit: string }` | A snap indicator is shown; not re-emitted while the snap point moves less than 1 map unit. `distance` is the formatted label text; `unit` is the configured unit name. |
| `proximity-clear` | none | Indicator removed; emitted once per cleared state |
| `proximity-hint` | `ProximityHint` | Activation (`active` or `no-targets`), Alt bypass (`idle`), leaving all targets (`no-targets`), deactivation (`idle`) |

```ts
document.addEventListener('proximity-snap', (e) => {
  const { coordinate, distance } = (e as CustomEvent).detail;
});
```

---

## DrawingCueEngine

Module: `Engines/DrawingCueEngine` (default export `DrawingCueEngine`, private constructor). Obtain with `DrawingCueEngine.getInstance()` or `symbolEngine.drawingCueEngine`. The harness also assigns the singleton to `window.drawingCueEngine` in `src/main.ts` so plain scripts can call `openCompassWidget()`.

Overlays drawn while the user draws (graphics layer id `DrawingCueLayer`, on-the-ground):

- Rubber band: dashed line from the last committed vertex to the cursor with a live length and bearing label.
- Coordinate display: cursor latitude/longitude readout (`nnn.nnnnn°N  nnn.nnnnn°E`).
- Angular guides: snap lines from the last vertex every `snapIntervalDeg`, with optional protractor arc, live bearing needle, fan, snap point marker and anchor marker.
- Distance rings around the last vertex, or around the cursor for point symbols (which commit no vertex).
- Nearby highlight: rings around existing symbols within `radiusKm` of the cursor, colored near/mid/far.
- Close cue: a ring on the first vertex when a polygon has at least 3 committed vertices (16 CSS px hotspot).
- Magnetic compass child engine (below).

### Types

```ts
interface DrawingCueOptions {
  enabled?: boolean;
  closeCue?: boolean;
  rubberBand?: { enabled?; lineColor?; lineOpacity?; lineWidth?; showLabel?; fontSize?; fontColor? };
  coordinateDisplay?: { enabled?; fontSize?; fontColor? };
  angularGuides?: {
    enabled?; snapThresholdDeg?; snapIntervalDeg?; lineColor?; lineOpacity?; lineWidth?;
    showLabel?; fontSize?; showArc?; arcRadiusKm?; showFan?; showSnapPoint?; showAnchor?;
    relativeSegment?: boolean;
    protractorDetail?: 'full' | 'reduced';     // engine option; not present in Settings.json
  };
  distanceRings?: { enabled?; intervalKm?; ringCount?; lineColor?; lineOpacity?; lineWidth?; showLabels?; fontSize?; fontColor? };
  nearbyHighlight?: { enabled?; radiusKm?; ringRadiusKm?; nearColor?; midColor?; farColor?; outlineWidth?; outlineOpacity? };
  adaptive?: { enabled?; coverageFraction?; maxOuterKm? };
  magneticCompass?: MagneticCompassOptions;
}
```

Colors are `[r,g,b]` arrays; opacities are 0..1; sizes are pixels; distances are kilometres. Field-by-field defaults and meanings are listed under `drawingCues.*` in the [settings reference](08-settings.md#drawingcues). Notable engine-only defaults that differ from the shipped JSON: `distanceRings.ringCount` 3 (JSON 5), `rubberBand.fontSize` 12 and `fontColor` white (JSON 11 and `[255,230,50]`), `coordinateDisplay.fontSize` 12 (JSON 11), `protractorDetail` `'reduced'` (not in JSON).

### Methods

| Method | Signature | Behavior |
| --- | --- | --- |
| `getInstance` | `static (): DrawingCueEngine` | Singleton. |
| `isEnabled` | `get: boolean` | Engine state. Initial value is `true` in the class. |
| `isActive` | `get: boolean` | True while a draw session is being tracked. |
| `compassEngine` | `get: MagneticCompass \| null` | The child compass; non-null after `start()`. |
| `start` | `(view: MapView \| SceneView): void` | Attach, create the layer, create and start the compass. |
| `enable` | `(): void` | Sets enabled; restores the compass if `disable()` had switched it off. |
| `disable` | `(): void` | Sets disabled, deactivates any active session, and disables the compass (remembering its state for the next `enable()`). |
| `toggle` | `(): boolean` | Flip; returns new `isEnabled`. |
| `activate` | `(targetLayerIds: string[]): void` | Begin a draw session (idempotent; requires enabled and a layer). Snapshots the centroids of graphics in the given layers for the nearby highlight and pre-builds highlight rings; attaches a capture-phase `pointermove` handler throttled to about 60 fps. |
| `updateFromProgress` | `(geom: Geometry, ctrlPts: Point[]): void` | Feed draw progress. The last element of `ctrlPts` is the live cursor; the committed anchor is the one before it. Rebuilds rings and the protractor when the vertex count changes; arms the close cue for polygons with 3 or more committed vertices. |
| `deactivate` | `(): void` | Remove listeners and all transient graphics. Emits `drawing-cue-state-change` with `isActive: false`. |
| `onViewChanged` | `(view: MapView \| SceneView): void` | Also forwards to the compass; deactivates and rebuilds the layer. |
| `setOptions` | `(opts: DrawingCueOptions): void` | Merge defined fields. `enabled` calls `enable()` / `disable()`. Turning `angularGuides.showArc` off removes protractor and needle graphics immediately. `magneticCompass` is forwarded to `MagneticCompass.setOptions`. |
| `getStatus` | `(): { isEnabled, isActive, isGeodesic, adaptiveEnabled, candidates, activeGraphics }` | State snapshot. |
| `openCompassWidget` | `(): void` | Enables the compass, dispatches a `settingsChanged` event for `drawingCues.magneticCompass.enabled = true` (so panels update), and opens the compass panel. |
| `closeCompassWidget` | `(): void` | Hides the compass panel. |

Adaptive ring spacing (`adaptive.enabled`): interval = `min(minViewDimensionKm * coverageFraction / 2, maxOuterKm) / ringCount`, with a floor of 0.001 km.

Settings mapping: any `drawingCues.*` change re-applies the entire block via `setOptions`. `features.drawingCues` calls `enable()` / `disable()` if the engine exists. Two enable switches therefore exist: `features.drawingCues` (boot gate and master switch) and `drawingCues.enabled` (inside the block).

### Events

| Event | Target | `detail` | When |
| --- | --- | --- | --- |
| `drawing-cue-state-change` | `document`, bubbles | `{ isActive: boolean }` | `activate()` (true), `deactivate()` (false) |
| `settingsChanged` | `window` | `{ path, value }` (no `fullPath`) | Sent by `openCompassWidget()` and by the compass widget when opacity, size, north color, bezel color or declination is changed. Paths are `['drawingCues','magneticCompass', <key>]`. A bridge listener as described in [08](08-settings.md#bridging-the-event-to-the-engine) is required for these to reach `onSettingChanged`. |

### MagneticCompass

Module: `Engines/Cue/MagneticCompass` (named export `MagneticCompass`; not a singleton, one instance is owned by `DrawingCueEngine`). Access it via `symbolEngine.drawingCueEngine.compassEngine`.

The compass places one or more interactive compass roses on the map. The user drags the bezel to set a bearing; a bearing line, optional back-azimuth and intersection markers are drawn; sector cones can be attached to a compass. Graphics layer id: `MagneticCompassLayer`. Placement of a new compass is done by clicking the map while the compass is enabled and in placing mode, started from the compass panel ("+ Add Compass"); there is no public method that adds a compass at a coordinate. A compass can also be created by `importFromJSON`.

```ts
interface MagneticCompassOptions {
  enabled?: boolean;
  size?: number;                       // px, default 210
  opacity?: number;                    // default 1.0
  northColor?: [number, number, number];   // default [255,80,80]
  bezelColor?: [number, number, number];   // default [212,160,60]
  declination?: number;                // degrees, positive east; class default 1.5
}

interface SectorConeOptions {
  centerBearingDeg: number;            // 0-359, direction the sector points
  arcWidthDeg: number;                 // 1-360, clamped; 360 = full circle
  radiusKm: number;                    // > 0
  color?: [number, number, number];    // default [255,165,0]
  fillOpacity?: number;                // default 0.25
  outlineOpacity?: number;             // default 0.75
  outlineWidth?: number;               // px, default 1.5
  extrudeHeightM?: number;             // metres, 3D only; 0 or omitted = flat
  label?: string;
}
```

| Method | Signature | Behavior |
| --- | --- | --- |
| `start` | `(view: MapView \| SceneView): void` | Attach; records whether the view is 3D. |
| `isEnabled` | `get: boolean` | Live state. |
| `enable` / `disable` | `(): void` | Register/remove the view's drag, pointer-move and click handlers. |
| `openWidget` / `closeWidget` | `(): void` | Show/hide the management panel (styles are injected by the class). |
| `onViewChanged` | `(view): void` | Re-attach and rebuild each compass's symbols for 2D or 3D. |
| `setOptions` | `(opts: MagneticCompassOptions): void` | `enabled` calls `enable()`/`disable()`; the others refresh all compasses. |
| `exportToJSON` | `(): string` | Version 1 JSON of settings, compasses (id, label, longitude, latitude, bezelDeg) and their sectors. |
| `saveToFile` | `(): void` | Triggers a browser download of `magnetic-compasses.json`. |
| `loadFromFile` | `(): void` | Opens a file picker and imports the chosen JSON. Parse errors are caught and logged as a warning. |
| `importFromJSON` | `(json: string): void` | Replaces all compasses. Throws if the JSON is invalid or `version !== 1`. |
| `addSector` | `(compassId: string, opts: SectorConeOptions): string \| null` | Adds a sector cone; returns its id, or `null` if the compass id is unknown or `radiusKm <= 0`. |
| `updateSector` | `(compassId: string, sectorId: string, opts: Partial<SectorConeOptions>): void` | Patch and redraw. |
| `removeSector` | `(compassId: string, sectorId: string): void` | Remove one sector. |
| `clearSectors` | `(compassId: string): void` | Remove all sectors of a compass. |
| `destroy` | `(): void` | Remove handlers, compasses, panel and injected style. |

Compass ids are generated internally; obtain them from `exportToJSON()` (`compasses[].id`).

---

## MGRSEngine

Module: `Engines/MGRSEngine` (default export class `MGRSEngine`, private constructor; named exports `latLonToUTM`, `utmToLatLon`, and the `MGRSEngineOptions` type). Obtain with `MGRSEngine.getInstance()` or `symbolEngine.mgrsEngine`.

Draws a lat/lon-based grid: GZD (Grid Zone Designator) boundaries including the Norway and Svalbard exceptions, plus one UTM-aligned sub-grid level at a time. No external MGRS library is used (UTM math is implemented in the module). The grid is clamped to latitudes -80 to 84. The layer id is `MGRSGridLayer` (`listMode: 'hide'`, on-the-ground). Rebuilds are debounced by 200 ms and run when the view becomes `stationary`, after `setOptions`, and after `enable()`.

Only one sub-grid interval is drawn at a time: the finest enabled level that passes the zoom gate (100 m if enabled, else 1 km, else 10 km, else 100 km). The color, opacity and width of the drawn level come from that level's settings. GZD lines and labels are drawn in addition when `showGZD` is on.

### Options

```ts
interface MGRSEngineOptions {
  showGZD?: boolean;   show100K?: boolean;   show10K?: boolean;   show1K?: boolean;
  show100M?: boolean;                          // engine option; not present in Settings.json
  autoZoom?: boolean;
  gzdColor?, gzdOpacity?, gzdWidth?;
  hundredKColor?, hundredKOpacity?, hundredKWidth?;
  tenKColor?,  tenKOpacity?,  tenKWidth?;
  oneKColor?,  oneKOpacity?,  oneKWidth?;
  hundredMColor?, hundredMOpacity?, hundredMWidth?;   // engine option; not present in Settings.json
  showLabels?: boolean; labelSize?: number; labelColor?: [number, number, number]; labelOpacity?: number;
}
```

Engine defaults equal the shipped `mgrs.*` values (see the [settings reference](08-settings.md#mgrs)), plus `show100M: false` and 100 m line color `[255,200,50]`, opacity 0.2, width 0.3.

`autoZoom` gates by `view.zoom`: 100 km from zoom 6, 10 km from zoom 9, 1 km from zoom 12, 100 m from zoom 14. With `autoZoom = false` every enabled level is eligible (still only the finest is drawn).

### Methods

| Method | Signature | Behavior |
| --- | --- | --- |
| `getInstance` | `static (): MGRSEngine` | Singleton. |
| `start` | `(view: MapView \| SceneView): void` | No-op if already active. Creates and adds the layer and a `stationary` watcher. |
| `enable` | `(): void` | Requires `start()` first (no-op otherwise); schedules a rebuild. |
| `disable` | `(): void` | Clears the layer. |
| `toggle` | `(): boolean` | Flip; returns new `isEnabled`. |
| `setOptions` | `(opts: Partial<MGRSEngineOptions>): void` | Merges defined fields; schedules a rebuild if enabled. |
| `refresh` | `(): void` | Immediate rebuild if enabled. |
| `onViewChanged` | `(newView: MapView \| SceneView): void` | Clears handles and layer, restarts on the new view, rebuilds if enabled. |
| `destroy` | `(): void` | Full teardown; also clears the singleton, so the next `getInstance()` builds a new engine. |
| `isEnabled` / `isActive` | `get: boolean` | Enabled state / started state. |

Settings mapping: any `mgrs.*` change calls `setOptions` with the entire `mgrs` block (only if the engine exists). `features.mgrsEngine` enables or disables it, and creates it when it was skipped at boot. Note: the shipped `features.mgrsEngine` is `false`, meaning the engine is not created at boot; setting it `true` at runtime creates, starts, applies options and enables it.

### Coordinate helpers

```ts
latLonToUTM(latDeg: number, lonDeg: number, zone: number): { e: number; n: number }
utmToLatLon(zone: number, southern: boolean, easting: number, northing: number): { lat: number; lon: number }
```

`latLonToUTM` returns easting and northing in metres for the given zone number (the northing has 10,000,000 added for negative latitudes). `utmToLatLon` is the inverse; pass `southern = true` for southern-hemisphere coordinates. The caller must supply the zone; neither function selects it. Both use WGS84 with scale factor 0.9996.

```ts
import { latLonToUTM } from '@lib/Engines/MGRSEngine';
const zone = Math.floor((lon + 180) / 6) + 1;
const { e, n } = latLonToUTM(lat, lon, zone);
```

These helpers are also used by `VisualizationEngine.showMgrsDensity` (see [10](10-declutter-visualization.md)); the MGRS density heatmap works whether or not the grid overlay is enabled.

---

## Host wiring example

```ts
import SymbolEngine from '@lib/Engines/SymbolEngine';

const symbolEngine = new SymbolEngine(() => activeView);
(window as any).symbolEngine = symbolEngine;

// Bridge widget/palette changes into the engine (see 08-settings.md)
window.addEventListener('settingsChanged', (e) => {
  const { path, value } = (e as CustomEvent).detail;
  symbolEngine.onSettingChanged(path, value);
});

// Turn measurement on (lazy-loads the engine)
await symbolEngine.toggleMeasurement();
symbolEngine.measurementEngine?.setOptions({ dist_unit: 'kilometers', show_bng: true });

// Grid overlay (creates the engine on first use)
symbolEngine.onSettingChanged(['features', 'mgrsEngine'], true);
symbolEngine.onSettingChanged(['mgrs', 'show10K'], true);

// React to measurements
document.addEventListener('measurement-update', (e) => console.log((e as CustomEvent).detail));

// On 2D <-> 3D switch
symbolEngine.onViewChanged(newView);
```

---

## Verification notes

- Facts in this document come from `MeasurementEngine.ts`, `ProximityEngine.ts`, `DrawingCueEngine.ts`, `Cue/MagneticCompass.ts`, `MGRSEngine.ts`, `Support/GeoTools.ts`, the relevant parts of `SymbolEngine.ts`, and usage in `src/main.ts` and `index.html`.
- Whether `SceneView.zoom` is a numeric property (which the MGRS zoom gate depends on) was not verified from the ArcGIS SDK; the code falls back to 5 when it is not a number.
- The MagneticCompass panel's internal element ids and layout are not documented as public API.
