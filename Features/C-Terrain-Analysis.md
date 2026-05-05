# C · Terrain Analysis — Implementation Guide

## Overview

The Terrain Analysis features extend `DrawingCueEngine` and `MeasurementEngine` with live elevation data and introduce a new `TerrainEngine` singleton that wraps ArcGIS `ElevationLayer`, `geometryEngine`, and viewshed/LOS operations. Features C1–C3 hook into the existing `onDrawProgress` pipeline. C4 and C6 add passive overlay layers. C5 applies to 3D (SceneView) only. C7 extends MeasurementEngine's distance calculation.

---

## Architecture

- **New file**: `MS/Engines/TerrainEngine.ts` (singleton)
- **Feature flag**: `Settings.json → features.terrainEngine`
- **ArcGIS dependency**: `ElevationLayer` from `@arcgis/core/layers/ElevationLayer` (loaded dynamically when TerrainEngine initialises)
- **ElevationLayer URL**: configurable in `Settings.json → terrainEngine.elevationUrl` (defaults to ArcGIS World Elevation Service)

---

## C1 — Live Elevation Profile

**What it does**: As a polyline grows during drawing, query `ElevationLayer.queryElevation()` per segment. Show a floating inline SVG sparkline beside the rubber-band label displaying cumulative rise, fall, gain, loss, and slope % in real time.

**Integration point**: `DrawingCueEngine.updateFromProgress()` — add a new code path that calls `TerrainEngine.queryElevationAlongPath(ctrlPts)` asynchronously.

**Constraints**:
- `ElevationLayer.queryElevation(polyline, { demResolution: "finest-contiguous" })` returns a `Promise<ElevationQueryResult>` with a sampled polyline where each vertex has a z-value.
- Do NOT await this on the main draw-progress tick (would stall at 60fps). Instead, dispatch the query and update the sparkline only when the promise resolves. Use the latest resolved result; discard stale results if a newer query has been dispatched (track a query sequence counter `_elevQuerySeq`).
- Sparkline dimensions: 80×20 px inline SVG appended to the rubber-band label TextSymbol. The SVG is embedded as a data-URL in the label text using Unicode/HTML — but TextSymbol does not support HTML. Use a separate `Graphic` with a `PictureMarkerSymbol` whose `url` is a canvas-generated or SVG data-URL PNG, positioned at the rubber-band label midpoint.
- Alternatively (simpler): render the sparkline as a separate overlay `<canvas>` element positioned over the map view's container using screen-space coordinates from `view.toScreen(labelPoint)`. This avoids TextSymbol limitations.
- **Cumulative values**: as each new control point is added, accumulate total rise (sum of positive dZ) and total fall (sum of negative dZ) across all segments. Display: `↑ 42m ↓ 18m slope 6%` near the rubber-band label.

---

## C2 — Slope / Gradient Colour Cue

**What it does**: Compute rise-over-run per rubber-band segment and colour the rubber-band line: green (<8%), amber (8–15%), red (>15%).

**Integration point**: `DrawingCueEngine._updateRubberBand()` — after computing `dist` and `bearing`, call `TerrainEngine.getSlopeForSegment(from, to)` (returns a Promise). Update `_rbLineColor` based on the resolved slope.

**Constraints**:
- Slope = `|dZ| / horizontalDistance` × 100, where `horizontalDistance` is the geodesic length of the segment.
- `dZ` = elevation at `to` minus elevation at `from` (from `ElevationLayer.queryElevation()`).
- Because this is async, use the same stale-result discard pattern as C1 (sequence counter per segment).
- Colour thresholds: `<8% → [0, 200, 0]` (green), `8–15% → [255, 165, 0]` (amber), `>15% → [220, 30, 30]` (red).
- When TerrainEngine is unavailable or the query fails, fall back to default rubber-band colour without error.
- Show slope % in the rubber-band label: `"1.2 km  N45°E  slope: 11%"`.

---

## C3 — Line-of-Sight (LOS) Cone

**What it does**: From the last confirmed control point, run a live LOS query toward the cursor. Render a green/red shaded arc showing visible vs. occluded sectors. Show "Intervisible" / "Masked" label.

**Integration point**: New method in `DrawingCueEngine._onCursorMove()` — when `_lastCtrlPt` is set and TerrainEngine is available, call `TerrainEngine.runLOS(observer, target)`.

**Constraints**:
- Use ArcGIS `ElevationLayer` and `geometryEngine` together. For a true LOS: sample elevation at N points along the line from observer to target (e.g., every 100 m). Compare each sampled elevation to the line-of-sight elevation at that distance. If any point is above the LOS line, the target is masked.
- Alternatively use `SceneView`'s built-in LOS analysis widget for 3D mode.
- For 2D mode (MapView): implement a manual terrain profile LOS check using `ElevationLayer.queryElevation()` along the polyline.
- LOS indicator: render a `Polygon` sector (fan) from `_lastCtrlPt` toward the cursor. Green fill = visible, red hatched fill = masked. The sector opens to ±30° around the observer-to-cursor bearing.
- Label: TextSymbol at cursor position showing "Intervisible" (green) or "Masked" (red).
- Rate-limit: max one LOS query per 200 ms (debounce). Stale queries discarded.
- Layer: render on `"DrawingCueLayer"` as temporary graphics, cleared on each cursor move tick.

---

## C4 — Terrain Passability Overlay

**What it does**: On draw start, query a slope-class raster and render a semi-transparent passability layer: green = wheeled OK (<8%), amber = tracked only (8–15%), red = impassable (>15%).

**Constraints**:
- Trigger: `DrawingCueEngine.activate()` emits a `"terrain-passability-request"` event. `TerrainEngine` listens and generates the overlay.
- Implementation: query `ElevationLayer` at a grid of points across the current map extent (e.g., every 500 m). Compute slope between adjacent points. Classify each cell. Render as a grid of semi-transparent `SimpleFillSymbol` Polygon squares on a `"terrain-passability-layer"` GraphicsLayer.
- Resolution: adapt grid spacing to zoom level. At low zoom (scale > 1:500k): 2 km grid. At medium zoom: 500 m. At high zoom: 100 m.
- The passability layer is regenerated when the map extent changes (debounced, 500 ms after pan/zoom ends). Listen to `view.watch("extent")` with debounce.
- Remove passability layer on `DrawingCueEngine.deactivate()`.
- Feature flag: `Settings.json → features.terrainPassability`.

---

## C5 — Terrain Following (3D)

**What it does**: In `SceneView`, auto-adjust symbol elevation to the ground surface with an optional user-set offset.

**Constraints**:
- This is a rendering-level setting, not a new engine. When a graphic is placed in a SceneView, set its layer's `elevationInfo`:
  ```javascript
  graphicsLayer.elevationInfo = { mode: "on-the-ground", offset: userOffsetMeters }
  ```
- For symbols that should float above ground (e.g. aircraft), the user sets offset via `DrawEssentials.ELEVATION_OFFSET` (a new field).
- `GraphicsLayerManager.getOrCreateLayer()` must pass `elevationInfo` when creating layers if the active view is a `SceneView`.
- For existing layers already on the map: update `layer.elevationInfo` in `SymbolEngine.onViewChanged()` when switching to SceneView.
- The `ELEVATION_OFFSET` is stored in `graphic.attributes.drawEssentials.ELEVATION_OFFSET` (default 0).

---

## C6 — Flood / Obscuration Risk Highlight

**What it does**: Highlights low-lying areas and dead ground behind ridges with a semi-transparent overlay. Useful for defensive planning.

**Constraints**:
- **Dead ground** (areas not visible from observer): computed via the inverse of LOS cone (C3). Polygon areas that are masked by ridges are dead ground.
- **Low-lying areas**: grid cells below a user-defined elevation threshold (e.g., relative to observer elevation or absolute). Configurable in `Settings.json → terrainEngine.floodThresholdMeters`.
- Rendering: semi-transparent `SimpleFillSymbol` with blue fill (flood/low-lying) or grey fill (dead ground) on a `"terrain-obscuration-layer"`.
- Trigger: available as a manual toggle button in the HUD, not auto-activated.
- Rate-limited: query and render at most once per 2 seconds while the toggle is active.

---

## C7 — Slant-Range (3D) Distance

**What it does**: In 3D mode, replace 2D geodesic length with a 3D calculation incorporating delta-Z from ElevationLayer.

**Integration point**: `MeasurementEngine._segLen()` — add a new variant `_segLen3D(pt1, pt2)` that queries elevation at both endpoints and computes `sqrt(horizontalDist² + dZ²)`.

**Constraints**:
- Only active in SceneView (`_getView().type === "3d"`) or when `MeasurementEngine.setOptions({ use3DDistance: true })` is explicitly set.
- Elevation queries are async. Use the same stale-result discard pattern (sequence counter).
- Display: append `" (3D)"` suffix to the segment label to distinguish from 2D measurements.
- 3D total length: sum of all slant-range segment lengths.
- Fall back to 2D geodesic if elevation query fails or TerrainEngine is unavailable.

---

## TerrainEngine Public API

```typescript
class TerrainEngine {
  static getInstance(): TerrainEngine;
  start(view: MapView | SceneView, elevationUrl?: string): void;
  onViewChanged(view: MapView | SceneView): void;

  // Async operations
  queryElevationAtPoint(pt: Point): Promise<number>;  // returns elevation in meters
  queryElevationAlongPath(pts: Point[]): Promise<{ pts: Point[], totalRise: number, totalFall: number }>;
  getSlopeForSegment(from: Point, to: Point): Promise<number>;  // returns slope %
  runLOS(observer: Point, target: Point): Promise<{ isVisible: boolean, profilePts: { dist: number, elev: number }[] }>;
  getPassabilityGrid(extent: Extent, cellSizeM: number): Promise<{ polygon: Polygon, class: "wheeled"|"tracked"|"impassable" }[]>;
}
```

---

## Settings.json Additions

```json
"features": { "terrainEngine": true, "terrainPassability": true },
"terrainEngine": {
  "elevationUrl": "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
  "losMaxRangeKm": 10,
  "losProfileSampleIntervalM": 100,
  "floodThresholdMeters": 50,
  "passabilityGridUpdateDebounceMs": 500
}
```

---

## Implementation Order

1. Implement `TerrainEngine.ts` with `start()`, `queryElevationAtPoint()`, `queryElevationAlongPath()`, `getSlopeForSegment()`.
2. Wire C2 (slope colour) into `DrawingCueEngine._updateRubberBand()`.
3. Wire C1 (elevation sparkline) into `DrawingCueEngine.updateFromProgress()`.
4. Implement C3 (LOS) in `DrawingCueEngine._onCursorMove()`.
5. Add C4 (passability overlay) as a separate `TerrainEngine.renderPassabilityOverlay()` method.
6. Add C5 (terrain following) to `GraphicsLayerManager.getOrCreateLayer()`.
7. Add C7 (slant range) to `MeasurementEngine._segLen()`.
8. Add C6 (dead ground/flood) as a HUD-toggled feature.
