# H · Smart Visualisation & Map Intelligence — Implementation Guide

## Overview

These features add zoom-reactive display logic to `SymbolEngine` and `GraphicsLayerManager`. The goal is to ensure that at any zoom level, the map is readable — the right symbols at the right scale, clustered when dense, dimmed when inactive. All features hook into the existing `reactiveUtils.watch(() => view.zoom, ...)` watcher already present in `SymbolEngine`.

---

## Architecture

- All H features extend `SymbolEngine.ts` and `GraphicsLayerManager.ts`.
- **New module**: `MS/Modules/ClusterManager.ts` for H3 symbol clustering.
- **Feature flags**: `Settings.json → features.zoomScaling`, `features.echelonLayers`, `features.clustering`, `features.symbolOpacity`.

---

## H1 — Zoom-Level Symbol Scaling

**What it does**: At brigade scale, render only brigade/battalion icons. At company scale, reveal company/platoon symbols. `milsymbol` size scales proportionally with zoom.

**Constraints**:
- The existing `reactiveUtils.watch(() => this._getView()?.zoom, ...)` watcher in `SymbolEngine` is currently a no-op. Activate it with the following logic.
- **Echelon visibility thresholds** (configurable in `Settings.json → zoomScaling.thresholds`):
  ```json
  {
    "brigade":   { "minZoom": 0,  "maxZoom": 12 },
    "battalion": { "minZoom": 8,  "maxZoom": 14 },
    "company":   { "minZoom": 11, "maxZoom": 16 },
    "platoon":   { "minZoom": 13, "maxZoom": 22 }
  }
  ```
- **Echelon detection**: from `graphic.attributes?.drawEssentials?.AMPLIFIER?.SIDC`, parse using `parseSIDC(sidc).setA.echelonMobility`. Map echelon code to category (e.g. code `"4"` = brigade, `"3"` = battalion, `"2"` = company, `"1"` = platoon).
- **Visibility**: on each zoom change, iterate all graphics in FORCE, TACT_PT, TACT layers. For each graphic, determine its echelon. Show/hide by setting `graphic.visible = (zoom >= threshold.minZoom && zoom <= threshold.maxZoom)`.
- **Symbol size scaling**: milsymbol-based Point symbols (`PictureMarkerSymbol` / `PointSymbol3D`) should scale proportionally. At the base zoom (e.g. zoom 12), use the stored `drawEssentials.SIZE`. At other zooms, scale proportionally: `displaySize = baseSize × 2^(zoom - baseZoom) × scaleFactor`. Clamp: `Math.max(12, Math.min(120, displaySize))`.
- Size update: mutate `graphic.symbol.width` and `graphic.symbol.height` (for `PictureMarkerSymbol`) in-place. Do NOT regenerate the entire symbol SVG on every zoom change — only update width/height properties.
- Debounce: use `reactiveUtils.watch` with the existing pattern but debounce symbol updates 100ms after zoom settles to avoid per-frame updates while zooming.

---

## H2 — Echelon Layer Groups

**What it does**: Separate `GraphicsLayer` per echelon. A layer-visibility toggle panel lets the planner isolate one echelon instantly.

**Constraints**:
- **Layer naming scheme**: `"symbols-brigade"`, `"symbols-battalion"`, `"symbols-company"`, `"symbols-platoon"`, `"symbols-unclassified"`.
- **`GraphicsLayerManager`**: add method `getEchelonLayer(echelon: string): GraphicsLayer`. Creates the layer if it doesn't exist. Layer stacking order: brigade at top (visually drawn last = on top), platoon at bottom.
- **Symbol placement**: in `SymbolEngine.drawSymEnd()`, instead of always adding to `LAYER_NAMES.FORCE`, determine echelon from the SIDC and call `this._layerManager.getEchelonLayer(echelon)`.
- **Toggle panel**: a floating `<div id="echelon-layer-panel">` with checkboxes for each echelon. Toggle calls `layer.visible = checked`. Panel is always visible (not just during drawing). Position: left side of map, mid-height.
- **Interaction with H1**: H1 zoom thresholds override layer visibility. H2 manual toggle adds an additional user-driven visibility filter. Both must be respected (a layer is visible only if `H1_visible && H2_userToggle`).

---

## H3 — Symbol Clustering (Heat Tiles)

**What it does**: When symbol density exceeds a threshold per screen tile, replace individual symbols with a count badge and convex hull overlay. Expanding a cluster reveals constituent symbols.

**Architecture**: `MS/Modules/ClusterManager.ts`

**Constraints**:
- **Clustering trigger**: on each `view.watch("extent")` and `view.watch("zoom")` (debounced 200ms), `ClusterManager.recompute()` is called.
- **Tile-based density**: divide the current view extent into a 10×8 grid of screen tiles (each ~100px). For each tile, collect all graphics whose screen-space centroid falls within the tile. If `count > densityThreshold` (default 5), cluster that tile.
- **Screen-space centroid**: `view.toScreen(graphic.geometry.extent.center)` for poly graphics; `view.toScreen(graphic.geometry)` for point graphics.
- **Cluster representation**:
  1. Hide constituent individual symbol graphics (`graphic.visible = false`).
  2. Add a cluster `Graphic` to `"cluster-layer"` at the centroid of the tile. Symbol: a `SimpleMarkerSymbol` circle with the count as a text label via a `TextSymbol`. Use badge style (circle + number).
  3. Add a convex hull outline `Graphic`: `geometryEngine.convexHull(multipoint)` of all constituent symbol centroids. Render as a dashed `SimpleLineSymbol`.
- **Expanding a cluster**: click on the cluster badge. `ClusterManager.expand(clusterGraphic)` restores `graphic.visible = true` for all constituent graphics and removes the cluster badge and hull. The cluster remains expanded until a zoom/extent change triggers `recompute()` again.
- **Cluster badge style**: circle diameter scales with count: 30px (2–9), 40px (10–49), 50px (50+). Background colour: blue for friendly, red for hostile. Count text in white, bold, 12px.
- **Performance**: only cluster graphics in the current view extent (skip off-screen graphics). Limit clustering computation to 500ms total; abort if exceeded.

---

## H4 — Symbol Opacity by Role

**What it does**: Dims inactive/reference symbols (grey, 40% opacity) while the active plan's symbols remain fully opaque. Reduces visual noise.

**Constraints**:
- **Active plan symbols**: graphics with `attributes.planType === activePlanType`. When no plan is active: all symbols are fully opaque.
- **Dim mechanics**: for each non-active graphic, modify its symbol's colour channels. For `PictureMarkerSymbol`: set `opacity` on the symbol (ArcGIS supports `PictureMarkerSymbol.opacity` as a value 0–1 starting from ArcGIS JS 4.26). For `SimpleFillSymbol`/`SimpleLineSymbol`: reduce colour alpha channels to 40% of original.
- **Original colour preservation**: before dimming, store original opacity in `graphic.attributes.originalOpacity`. Restore on plan deactivation.
- **Greying**: additionally desaturate non-active symbols by converting their symbol's colour to greyscale. For `PictureMarkerSymbol`: not possible directly — instead set `opacity = 0.4`. For vector symbols: replace `[r, g, b]` with `[grey, grey, grey]` where `grey = 0.299*r + 0.587*g + 0.114*b`.
- **Update trigger**: listen to `"plan-type-change"` (from PlanEngine A1). On change, iterate all graphics and apply/restore dimming.
- **Pairs with H2**: dimming is independent of echelon visibility. A dimmed symbol can still be toggled invisible by H2.
- **Performance**: batch all graphic symbol mutations before triggering a render. ArcGIS GraphicsLayer re-renders after each `graphic.symbol` assignment, so minimise assignments by checking whether the symbol already has the correct opacity.

---

## Settings.json Additions

```json
"features": {
  "zoomScaling": true,
  "echelonLayers": true,
  "clustering": true,
  "symbolOpacity": true
},
"zoomScaling": {
  "baseZoom": 12,
  "scaleFactor": 0.7,
  "minSymbolSize": 12,
  "maxSymbolSize": 120,
  "thresholds": {
    "brigade":   { "minZoom": 0,  "maxZoom": 12 },
    "battalion": { "minZoom": 8,  "maxZoom": 14 },
    "company":   { "minZoom": 11, "maxZoom": 16 },
    "platoon":   { "minZoom": 13, "maxZoom": 22 }
  }
},
"clustering": {
  "densityThreshold": 5,
  "gridCols": 10,
  "gridRows": 8,
  "debounceMs": 200
},
"symbolOpacity": {
  "inactiveOpacity": 0.4,
  "greyInactive": true
}
```

---

## Implementation Order

1. Activate `view.watch("zoom")` handler in `SymbolEngine` — implement H1 visibility and size scaling.
2. Add `getEchelonLayer()` to `GraphicsLayerManager` — update `drawSymEnd()` to use echelon layers (H2).
3. Build echelon toggle panel UI component (H2).
4. Implement `ClusterManager.ts` with tile density, badge rendering, expand-on-click (H3).
5. Wire `ClusterManager.recompute()` to `view.watch("extent")` and `view.watch("zoom")` (H3).
6. Implement opacity dimming on `"plan-type-change"` in `SymbolEngine` (H4).
