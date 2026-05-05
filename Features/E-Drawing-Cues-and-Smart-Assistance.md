# E · Drawing Cues & Smart Assistance — Implementation Guide

## Overview

This section extends the existing `DrawingCueEngine` with MGRS/terrain snapping, weapon-specific visual overlays, corridor bands, symbol preview ghosts, shape auto-completion, and cursor mode management. All features are integrated into the existing `DrawingCueEngine` singleton and its `setOptions()` / `activate()` / `_onCursorMove()` pipeline without breaking existing functionality.

---

## Architecture Constraints

- All E-section features live in `DrawingCueEngine.ts` unless stated otherwise.
- New options are added to the `DrawingCueOptions` interface.
- New feature flags in `Settings.json → drawingCues.*`.
- Terrain/elevation queries delegate to `TerrainEngine` (Section C) via a lazy reference.
- SIDC-specific config (weapon danger rings, sector arcs) stored in `MS/Data/WeaponProfiles.json`.

---

## New Data File: `WeaponProfiles.json`

```json
{
  "10036000": {
    "label": "Artillery",
    "sectorOfFireDeg": 360,
    "minRangeKm": 3,
    "maxRangeKm": 25,
    "deadZoneDeg": 20,
    "fragRadiusM": 400,
    "blastRadiusM": 50,
    "minSafeDistanceM": 600
  },
  "10033000": {
    "label": "Armour",
    "sectorOfFireDeg": 60,
    "minRangeKm": 0.1,
    "maxRangeKm": 3,
    "fragRadiusM": 0,
    "blastRadiusM": 0,
    "minSafeDistanceM": 500
  }
}
```

---

## E1 — MGRS Grid Snap

**What it does**: On `pointermove`, snap control points to the nearest MGRS grid cell boundary at the current map scale.

**Constraints**:
- MGRS grid cell size varies by scale. Determine cell size from `view.scale`:
  - scale > 1:500k → 100 km grid
  - 1:100k–1:500k → 10 km
  - 1:25k–1:100k → 1 km
  - < 1:25k → 100 m
- Snap algorithm: convert cursor map coordinates to geographic (WGS84). Compute the nearest MGRS grid line intersection:
  - Round `lat` and `lon` to the nearest multiple of the cell size in degrees.
  - `snapLat = round(geoY / cellDeg) * cellDeg`, similarly for `snapLon`.
  - Convert back to the view's spatial reference.
- Apply snap only when `E1Enabled` and only within a configurable screen-pixel threshold (default 20px). If cursor is farther than threshold from nearest grid line, do not snap.
- The snapped coordinate is passed to `DrawingCueEngine._onCursorMove()` before the rubber band and other cues are rendered. All downstream cues use the snapped position.
- Visual indicator: a small cyan crosshair marker `(+)` rendered at the snap point on `"DrawingCueLayer"`.
- Option key: `drawingCues.mgrsSnap: { enabled, cellSizeOverrideM, snapThresholdPx }`.

---

## E2 — Predictive Terrain Snapping

**What it does**: Snap to terrain features (ridge lines, roads, rivers via feature layers), formation anchors, and existing unit centres.

**Constraints**:
- Implement as an extension of `ProximityEngine`'s snap indicator. When `E2Enabled`, after the MGRS snap check (E1), also check against candidate snap targets from configured feature layers.
- Snap target sources (configurable):
  1. `FormationAnchorLayer` — layer of Point graphics with `attributes.formationAnchor = true`.
  2. ArcGIS `FeatureLayer` IDs configured in `Settings.json → drawingCues.terrainSnapLayerIds` (e.g. roads, rivers).
  3. Existing unit centroids (already handled by `ProximityEngine` — piggyback on its `_candidateSnapshot`).
- Nearest-point computation: `geometryEngine.nearestCoordinate(featureGeom, cursorPt)` for each candidate. Apply the same `snapRadiusPx` threshold as ProximityEngine.
- Priority: E1 (MGRS) > E2 terrain features > ProximityEngine unit snap. Apply first matching snap.

---

## E3 — Orthogonal / 45° Military Grid Snapping

**What it does**: Hold a modifier key (e.g. Shift) to constrain bearing to 0°/45°/90° increments from the last control point.

**Constraints**:
- Track modifier key state in a module-level boolean `_orthogonalMode: boolean`. Update on `keydown`/`keyup` for `"Shift"` key (or configurable key in `Settings.json → drawingCues.orthogonalKey`).
- When `_orthogonalMode = true`, snap the cursor's position:
  1. Compute bearing from `_lastCtrlPt` to raw cursor.
  2. Round bearing to nearest multiple of 45°.
  3. Compute snapped cursor position: `snappedCursor = _lastCtrlPt + direction(snappedBearing) × dist(cursor - _lastCtrlPt)`.
- The snapped cursor replaces the raw cursor in all subsequent `_onCursorMove` computations.
- Visual indicator: show the constrained bearing as an orange guide line (full extent of view) when orthogonal mode is active.
- This runs AFTER E1 and E2 snaps (orthogonal takes highest priority when active).

---

## E4 — Sector-of-Fire Arc

**What it does**: When the active symbol is a weapon system (SIDC matches a `WeaponProfiles.json` entry), render a fan arc from the last confirmed control point. Arc rotates live with the cursor.

**Constraints**:
- Check active SIDC on `DrawingCueEngine.activate()`. Look up `WeaponProfiles.json` by SIDC prefix (first 8 characters). Store result in `_weaponProfile`.
- If `_weaponProfile` exists and `sectorOfFireDeg > 0`:
  - Compute bearing from `_lastCtrlPt` to cursor.
  - Build fan polygon: centre = `_lastCtrlPt`, left edge = bearing − halfAngle, right edge = bearing + halfAngle, range = `maxRangeKm`.
  - If `minRangeKm > 0`: subtract an inner circle (dead zone) from the fan using `geometryEngine.difference()`.
  - Render as `SimpleFillSymbol` with amber fill (0.2 opacity) and amber outline on `"DrawingCueLayer"`.
- Update the fan every `_onCursorMove` tick (rate-limited to 60 fps already).

---

## E5 — Weapon Danger Rings

**What it does**: When active SIDC is a weapon system, replace generic distance rings with doctrine-defined radii: min safe distance, fragmentation radius, blast radius.

**Constraints**:
- When `_weaponProfile` is detected (E4), set `_ringsEnabled = false` (disable generic rings) and render weapon-specific rings instead.
- Three rings per weapon:
  1. Blast radius (`blastRadiusM`): red fill circle, full opacity outline.
  2. Fragmentation radius (`fragRadiusM`): amber fill circle, dashed outline.
  3. Minimum safe distance (`minSafeDistanceM`): green dashed outline, no fill.
- Each ring is a `geometryEngine.geodesicBuffer(center, radius, "meters")` Graphic on `"DrawingCueLayer"`.
- Labels for each ring (e.g. `"Blast: 50m"`, `"Frag: 400m"`, `"Min Safe: 600m"`) as TextSymbol graphics positioned at the top of each ring circle.
- When no weapon profile: fallback to generic distance rings (existing behaviour).

---

## E6 — Corridor / Buffer Band

**What it does**: `geometryEngine.geodesicBuffer()` on the live polyline renders a shaded lateral clearance corridor. Width is configurable per symbol type.

**Constraints**:
- Active only for Polyline symbol types (`drawEssentials.SymGeoType === "Polyline"`).
- Corridor width source (priority order):
  1. `_weaponProfile.corridorWidthKm` (if weapon profile exists).
  2. `drawEssentials.CORRIDOR_WIDTH_KM` (user override stored on drawEssentials).
  3. `Settings.json → drawingCues.defaultCorridorWidthKm` (default 1.0).
- Render: `SimpleFillSymbol` with semi-transparent blue fill (0.15 opacity) and blue dashed outline. Graphic on `"DrawingCueLayer"` — cleared and redrawn each `updateFromProgress()` call.
- Performance: buffer computation is synchronous (`geometryEngine.geodesicBuffer`). For very long polylines (>50 vertices), subsample the polyline to 20 points for buffer computation.
- When corridor width = 0, this feature is disabled for that symbol.

---

## E7 — Threat-Radius Colour Zones

**What it does**: Extends `nearbyHighlight` with filled concentric zones (red / amber / green) so risk reads instantly from colour.

**Constraints**:
- This is an enhancement to the existing `_updateNearbyHighlights()` method in `DrawingCueEngine`.
- Instead of one ring per nearby symbol, render three concentric filled zones:
  - Inner (danger) zone: `hlRadiusKm / 3` — red fill (0.15 opacity).
  - Middle (caution) zone: `hlRadiusKm * 2 / 3` — amber fill (0.1 opacity).
  - Outer (awareness) zone: `hlRadiusKm` — green fill (0.05 opacity).
- Each zone is computed with `geometryEngine.geodesicBuffer(centroid, zoneRadius, "kilometers")`.
- The three zone polygons replace the single ring graphic in `_candidateInfo[i].highlightGraphic`. Store as an array `highlightGraphics: Graphic[]`.
- Update colour intensity based on cursor distance: zones near the cursor have full opacity; zones far from the cursor fade to 20% of base opacity.
- Option: `drawingCues.nearbyHighlight.showConcentricZones: boolean`.

---

## E8 — Elevation Sparkline on Rubber-Band

**What it does**: 40×16 px inline mini-chart appended near the rubber-band label showing cumulative elevation change (rise and fall) along the drawn path.

**Constraints**:
- Rendered as a `<canvas>` element positioned in screen space over the map container, NOT as a TextSymbol (TextSymbol cannot render SVG/canvas content).
- The canvas element `id="elevation-sparkline"` is appended to the map view's container once on `DrawingCueEngine.activate()` and removed on `deactivate()`.
- Position: update canvas `style.left` and `style.top` on every `_onCursorMove` tick to track the rubber-band label midpoint position using `view.toScreen(midPt)`.
- Chart: a mini polyline chart drawn on the 40×16 canvas. X-axis = cumulative distance along path. Y-axis = elevation. Green area above baseline = rise; red area below = fall.
- Data: from `TerrainEngine.queryElevationAlongPath(ctrlPts)` (async, same stale-result pattern as C1).
- Show sparkline only when TerrainEngine is available and `showElevationSparkline: true` in options.

---

## E9 — Bearing Compass Rose

**What it does**: Small compass rose near cursor showing current bearing to the last control point; pointer rotates in real time.

**Constraints**:
- Rendered as an HTML `<div>` with a CSS-rotated needle arrow, positioned near the cursor in screen space (not on the map layer).
- Position: cursor screen position offset by (+30px, -30px) to avoid obscuring the cursor.
- Compass rose element: a simple SVG with a circle background and a triangle needle. The needle's `transform: rotate(${bearing}deg)` is updated on every `_onCursorMove`.
- Bearing shown: from `_lastCtrlPt` to cursor (same bearing computed for rubber-band label).
- If no `_lastCtrlPt`, show north-up (bearing = 0) with dimmed appearance.
- Cardinal labels N/E/S/W rendered as fixed text in the compass SVG (not rotated with the needle).
- Show/hide based on `drawingCues.compassRose.enabled` option.

---

## E10 — Symbol Preview Ghost

**What it does**: Before committing the first control point, render a semi-transparent preview of the SIDC symbol at the cursor position.

**Constraints**:
- Active only when drawing has not yet started (no `_lastCtrlPt` yet).
- Symbol rendering: the `SymbolEngine` must expose a method `getSymbolForSIDC(sidc, drawEssentials)` that returns a `PictureMarkerSymbol` or `SimpleMarkerSymbol` (the same symbol that would be placed on final draw).
- `DrawingCueEngine` stores a reference to `SymbolEngine` (injected via `DrawingCueEngine.setSymbolEngine(se: SymbolEngine)`). Call `se.getSymbolForSIDC(activeSidc)` on `activate()`.
- Ghost graphic: a `Graphic` with the retrieved symbol at 50% opacity (`symbol.opacity = 0.5` — note: ArcGIS symbol opacity is set on the `SimpleFillSymbol.color.a` channel, not a direct property). For `PictureMarkerSymbol`, create a canvas copy with reduced opacity.
- The ghost graphic is added to `"DrawingCueLayer"` and its `geometry` (a `Point`) is updated to cursor position on every `_onCursorMove`.
- Remove ghost on first click (when `_lastCtrlPt` is set for the first time in `updateFromProgress()`).

---

## E11 — Auto-Shape Completion

**What it does**: Double-click + Shift auto-closes a rectangle, circle, or regular polygon. "Draw as Formation" tool accepts template + click-center + direction.

**Constraints**:
- **Rectangle auto-close**: when the user double-clicks with Shift and has exactly 2 control points, compute the rectangle from those two diagonal corners. Add the 4 corner points to `CTRL_PTS` and emit `onDrawEnd`. The symbol's `createSymbol()` will receive the 4 points.
- **Circle auto-close**: when double-click + Shift with 1 control point (center) and cursor position as radius point, compute a regular 32-point polygon approximating a circle. Add all 32 points to `CTRL_PTS` and emit `onDrawEnd`.
- **Regular polygon**: n-sided polygon centred on `_lastCtrlPt` with radius = distance to cursor. Number of sides configurable (4, 5, 6, 8, etc.) — show a small picker UI when Shift+double-click occurs.
- **"Draw as Formation"**: a new drawing mode activated by a toolbar button. The user selects a formation template (line, column, wedge, echelon) from a dropdown, clicks a centre point, and drags to set direction. On mouse-release, `SelectionEngine.arrangeFormationType()` is called with the template type and computed spacing/direction to auto-place all selected subordinate symbols.
- Implementation: add `"formation"` as a value for `_cursorMode` (see E12). In formation mode, `_onCursorMove` shows a preview of the formation layout around the cursor.

---

## E12 — Cursor Modes

**What it does**: Keyboard-toggled modes: Freehand, Snap-to-grid, Terrain-follow, Formation. Visual indicator shows active mode.

**Constraints**:
- Add `_cursorMode: "freehand"|"snap-grid"|"terrain-follow"|"formation"` to `DrawingCueEngine`.
- Keyboard bindings (when drawing is active):
  - `F` → `"freehand"` (disables all snap)
  - `G` → `"snap-grid"` (enables E1 MGRS snap + E3 orthogonal)
  - `T` → `"terrain-follow"` (enables C2 slope colouring + C1 elevation sparkline)
  - `M` → `"formation"` (enables E11 formation mode)
- Mode indicator: a `<div id="cursor-mode-indicator">` in the bottom-left of the map container. Shows the current mode name. Updated on mode change.
- Modes are mutually exclusive. Switching to a new mode deactivates the previous mode's overlays.
- In `"freehand"` mode: disable E1, E2, E3 snaps. Disable angular guides.
- In `"snap-grid"` mode: enable E1 + E3. Enable angular guide lines.
- In `"terrain-follow"` mode: enable C2 slope colouring. Disable distance rings (replaced by slope cue).
- In `"formation"` mode: enable E11 formation preview. Disable all other cue overlays.
- Mode state persists across draw sessions (stored in `DrawingCueEngine._cursorMode`).

---

## Updated `DrawingCueOptions` Interface

```typescript
interface DrawingCueOptions {
  // ... existing fields ...
  mgrsSnap?: { enabled?: boolean; snapThresholdPx?: number };
  orthogonalSnap?: { enabled?: boolean; key?: string; angleDeg?: number };
  weaponProfile?: boolean; // auto-detect from SIDC
  corridorBand?: { enabled?: boolean; defaultWidthKm?: number };
  threatZones?: { enabled?: boolean; showConcentricZones?: boolean };
  elevationSparkline?: { enabled?: boolean };
  compassRose?: { enabled?: boolean };
  symbolPreviewGhost?: { enabled?: boolean };
  autoShapeCompletion?: { enabled?: boolean };
  cursorModes?: { enabled?: boolean; defaultMode?: string };
  sectorOfFire?: { enabled?: boolean };
}
```

---

## Settings.json Additions

```json
"drawingCues": {
  "mgrsSnap": { "enabled": true, "snapThresholdPx": 20 },
  "orthogonalSnap": { "enabled": true, "key": "Shift", "angleDeg": 45 },
  "weaponProfile": true,
  "corridorBand": { "enabled": true, "defaultWidthKm": 1.0 },
  "threatZones": { "enabled": true, "showConcentricZones": true },
  "elevationSparkline": { "enabled": true },
  "compassRose": { "enabled": true },
  "symbolPreviewGhost": { "enabled": true },
  "autoShapeCompletion": { "enabled": true },
  "cursorModes": { "enabled": true, "defaultMode": "snap-grid" }
}
```

---

## Implementation Order

1. Add `mgrsSnap` (E1) to `DrawingCueEngine._onCursorMove()`.
2. Add `orthogonalSnap` (E3) to `_onCursorMove()` with modifier key tracking.
3. Load `WeaponProfiles.json` on `activate()` — implement E4 sector arc and E5 danger rings.
4. Add corridor band (E6) to `updateFromProgress()`.
5. Add concentric threat zones (E7) to `_updateNearbyHighlights()`.
6. Implement compass rose (E9) and cursor mode indicator (E12) as HTML overlays.
7. Wire `SymbolEngine.getSymbolForSIDC()` and implement E10 ghost preview.
8. Implement elevation sparkline (E8) using canvas overlay + TerrainEngine.
9. Add auto-shape completion (E11) to double-click handler.
10. Integrate E2 terrain snapping with feature layer queries.
