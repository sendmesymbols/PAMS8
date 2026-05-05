# D · Collision & Safety Engine — Implementation Guide

## Overview

The `CollisionEngine` is a new singleton that performs doctrine-aware conflict detection during and after drawing. It consumes `onDrawProgress` and `onDrawEnd` events and integrates with `ProximityEngine` (for separation warnings) and `SymbolEngine` (for SIDC classification). All warnings are rendered as map graphics and emitted as document events for the HUD to consume.

---

## Architecture

- **New file**: `MS/Engines/CollisionEngine.ts` (singleton)
- **Feature flag**: `Settings.json → features.collisionEngine`
- **Data file**: `MS/Data/DoctrineRules.json` — defines safe-distance thresholds per SIDC category, exclusion zone IDs, phase-line rules
- **Registration**: `SymbolEngine._initCollisionEngine()` initialises on startup; wires to global draw events

---

## Data Schema: `DoctrineRules.json`

```json
{
  "safeDistances": {
    "infantry":   { "sidc_prefix": "10031000", "minSeparationM": 500 },
    "armour":     { "sidc_prefix": "10033000", "minSeparationM": 1500 },
    "artillery":  { "sidc_prefix": "10036000", "minSeparationM": 4000 },
    "default":    { "minSeparationM": 300 }
  },
  "frontageRules": {
    "brigade":   { "echelon": "4", "maxFrontagM": 10000, "maxDepthM": 6000 },
    "battalion": { "echelon": "3", "maxFrontagM": 3000,  "maxDepthM": 2000 }
  },
  "phaseLinesAffiliationSide": {
    "friendly": "1",
    "hostile":  "6"
  }
}
```

---

## D1 — Doctrine-Based Safe Distances

**What it does**: As the user draws a new symbol, compare its current position against all existing graphics of the same category. If separation is less than the doctrine minimum, render a pulsing amber ring around the new symbol and show a warning toast.

**Constraints**:
- **Category lookup**: parse the in-progress symbol's SIDC using `parseSIDC(sidc)` (already available). Extract `symbolSet` and `entityType` to determine category (infantry, armour, artillery, etc.). Map to `DoctrineRules.json → safeDistances` entries.
- **Separation check**: on every `onDrawProgress` event, compute `geometryEngine.distance(currentGeom, existingGraphic.geometry, "meters")` for each existing graphic of the same category. Use geodesic distance.
- **Pulsing amber ring**: create a `SimpleFillSymbol` with no fill and amber outline (`[255, 165, 0]`) at radius = `minSeparationM`. Add it as a Graphic on `"collision-overlay"` layer. "Pulsing" effect: update the outline's width between 2px and 4px on a 500ms interval using `setInterval` while the violation is active. Clear the interval when the violation clears.
- **Warning toast**: emit `"collision-warning"` on `document` with `{ type: "doctrine-separation", minSeparationM, actualSeparationM, sidc }`. The HUD subscribes and shows a dismissable toast.
- **Performance**: limit separation checks to graphics within a bounding box 2× the doctrine max distance from the cursor. Use `view.map.findLayerById()` and iterate the layer's `graphics` collection, filtering by extent overlap before the geometry distance call.

---

## D2 — Real-Time Friendly-Fire Separation Warning

**What it does**: Compare new symbol position against all blue-force (friendly affiliation) graphics live. Emit warning if within doctrine minimum separation.

**Constraints**:
- **Affiliation detection**: from `parseSIDC(sidc).setA.affiliation`. Friendly = `"1"` (per APP-6D/2525D). Only check against friendly graphics.
- This is a specialisation of D1. Implement as a flag `checkFriendlyFire: boolean` in `CollisionEngine.setOptions()`. When true, D2 runs simultaneously with D1 but filters only friendly-affiliation candidates.
- **Visual distinction from D1**: D2 warning ring colour = `[255, 80, 0]` (orange-red) vs D1's amber. Toast label: "Friendly Fire Risk".
- Emit `"collision-warning"` with `{ type: "friendly-fire", ... }`.

---

## D3 — Symbol Overlap / Collision Check

**What it does**: On each `onDrawProgress`, test the in-progress geometry against existing graphics via `geometryEngine.intersects()`. Flash a red halo on the colliding graphic and emit a `collision-warning` event.

**Constraints**:
- Run `geometryEngine.intersects(currentGeom, existingGraphic.geometry)` for all graphics in target layers (FORCE, TACT_PT, TACT).
- **Red halo**: for each colliding `existingGraphic`, add a duplicate Graphic (same geometry, `SimpleFillSymbol` with red outline, 4px width, `[220, 30, 30]`) to `"collision-overlay"` layer. Remove it when the collision clears.
- Track colliding graphic IDs in `CollisionEngine._collidingIds: Set<string>`. On each `onDrawProgress`, recompute the set; add/remove halo graphics as the set changes.
- Performance: only run collision checks for graphics whose extent overlaps the current geometry's extent (bounding-box pre-filter).
- Emit `"collision-warning"` with `{ type: "overlap", collidingGraphicIds: string[] }`.

---

## D4 — No-Go Zone Enforcement

**What it does**: Maintain a restricted-area polygon layer. When drawn geometry crosses one, overlay red hatched fill and emit a `no-go-zone-violation` event. Optionally hard-block the draw cursor inside zones.

**Constraints**:
- **No-go zone layer**: a `GraphicsLayer` named `"no-go-zones"`. Polygons in this layer have `attributes.noGoZone = true` and `attributes.noGoZoneId: string`.
- **Crossing detection**: on `onDrawProgress`, `geometryEngine.intersects(currentGeom, noGoZonePolygon)`. If true, overlay a red hatched `SimpleFillSymbol` on the intersecting zone in `"collision-overlay"`.
- **Hard-block mode** (optional, `Settings.json → collisionEngine.hardBlockNoGoZones: true`): when enabled, if the cursor maps to a point inside a no-go zone, snap the cursor back to the nearest point on the no-go zone boundary. Implement by intercepting `_onCursorMove` in `DrawingCueEngine` and calling `CollisionEngine.snapOutsideNoGoZone(cursorPt)` which returns the adjusted point.
- `snapOutsideNoGoZone(pt)`: iterate all no-go zone polygons, check `geometryEngine.contains(polygon, pt)`. If inside, call `geometryEngine.nearestCoordinate(polygon.boundary, pt)` and return the boundary coordinate.
- Emit `"no-go-zone-violation"` with `{ zoneId: string, violationType: "entry"|"crossing" }`.

---

## D5 — Exclusion Zone Snapping

**What it does**: Cursor automatically deflects away from user-defined danger areas (minefields, friendly positions) so the planner cannot accidentally place symbols inside them.

**Constraints**:
- Exclusion zones are `GraphicsLayer` graphics with `attributes.exclusionZone = true` and `attributes.exclusionZoneType = "minefield"|"friendly-pos"`.
- Integration with `ProximityEngine`: extend `ProximityEngine.activate()` to also snapshot exclusion zone graphics. In `_runProximity()`, if the cursor is within `exclusionSnapBufferM` (e.g. 200 m) of an exclusion zone boundary, deflect the snap coordinate to the nearest point on the **exterior** of the zone boundary.
- The deflection is visual only (affects the snap indicator position) unless hard-block is enabled (D4). Hard-block applies deflection to the actual control point coordinates.
- Emit `"proximity-hint"` (existing event from ProximityEngine) with phase `"no-targets"` and message indicating exclusion zone avoidance.

---

## D6 — Phase Line / Boundary Check

**What it does**: Warn when a unit symbol is placed on the wrong side of an active phase line or boundary. Derives expected side from the SIDC affiliation field.

**Constraints**:
- Phase lines are Polyline graphics with `attributes.phaseLine = true` and `attributes.phaseLineId`.
- On `onDrawEnd`, for each active phase line:
  1. Determine which side of the phase line the symbol was placed on using `geometryEngine.distance()` with sign. Compute the signed area of the triangle formed by phase line start, phase line end, and symbol position. Positive = left side, negative = right side.
  2. Friendly symbols (affiliation `"1"`) should be on the `DoctrineRules.phaseLinesAffiliationSide.friendly` side. Hostile on `"hostile"` side.
  3. If wrong side: emit `"collision-warning"` with `{ type: "phase-line-violation", phaseLineId, expectedSide }` and show a warning toast.
- Phase line layer ID: configurable via `Settings.json → collisionEngine.phaseLineLayerId` (default: `"tactical-graphics"`).

---

## D7 — Formation Integrity Check

**What it does**: When selected units are too spread out or too bunched relative to doctrine frontage/depth rules for the formation type, emit a formation-integrity warning.

**Constraints**:
- Triggered on `SelectionEngine "selectionChange"` event when ≥ 2 graphics are selected.
- **Computation**: 
  1. Determine the echelon of the highest-echelon selected symbol (from `parseSIDC(sidc).setA.echelonMobility`).
  2. Look up `DoctrineRules.frontageRules[echelon]`.
  3. Compute bounding box of all selected symbol centroids. Compare `bbox.width` to `maxFrontageM` and `bbox.height` to `maxDepthM`.
  4. If either dimension is violated: emit `"formation-integrity-warning"` with `{ echelon, actualFrontageM, maxFrontageM, actualDepthM, maxDepthM }`.
- Show warning in HUD while selection violates doctrine. Clear when selection changes or violation resolves.

---

## D8 — Doctrinal Rule Engine

**What it does**: Flags violations of spacing, frontage, depth, and command-relationship rules; configurable per echelon and unit type.

**Constraints**:
- This is the generalised framework for D1, D6, D7. Implement as a `DoctrinRuleEngine` class (or extend `CollisionEngine`) with a `validateGraphic(graphic, context)` method.
- `context` includes: active plan type, current selection, all graphics in scope, active phase lines, and the `DoctrineRules.json` config.
- `validateGraphic()` returns an array of `{ ruleId: string, severity: "warn"|"error", message: string }` objects.
- Rules are registered as named functions: `CollisionEngine.registerRule(ruleId, ruleFn)`. Default rules (D1, D6, D7) are registered on init. Custom rules can be added by the host app.
- Emit `"doctrine-violation"` on `document` for each violation found.

---

## CollisionEngine Public API

```typescript
class CollisionEngine {
  static getInstance(): CollisionEngine;
  start(view: MapView | SceneView, targetLayerIds: string[]): void;
  onViewChanged(view: MapView | SceneView): void;
  setOptions(opts: CollisionOptions): void;

  // D3, D1, D2 — called from SymbolEngine on draw progress
  checkProgress(currentGeom: Geometry, sidc: string): void;
  
  // D4 — called on drawEnd
  checkNoGoZones(geom: Geometry): void;
  
  // D5 — called from DrawingCueEngine
  snapOutsideNoGoZone(pt: Point): Point;

  // D6 — called on drawEnd
  checkPhaseLines(graphic: Graphic): void;

  // D7, D8 — called on selection change
  checkFormationIntegrity(selectedGraphics: Graphic[]): void;
  validateGraphic(graphic: Graphic, context: ValidationContext): ValidationResult[];

  // Route check for ScenarioEngine (B1, B3)
  checkRoute(routeGeom: Geometry, threatZoneGraphics: Graphic[]): CollisionResult[];
}
```

---

## Collision Overlay Layer

All visual warnings render on `"collision-overlay"` `GraphicsLayer`, always on top (add last to map). It is cleared completely on `onDrawEnd` and on `CollisionEngine.deactivate()`.

---

## Settings.json Additions

```json
"features": { "collisionEngine": true },
"collisionEngine": {
  "checkFriendlyFire": true,
  "checkOverlap": true,
  "checkNoGoZones": true,
  "hardBlockNoGoZones": false,
  "checkPhaseLines": true,
  "exclusionSnapBufferM": 200,
  "phaseLine LayerId": "tactical-graphics"
}
```

---

## Implementation Order

1. Create `DoctrineRules.json`.
2. Implement `CollisionEngine.ts` with `start()`, `checkProgress()`, `checkNoGoZones()`, `checkPhaseLines()`.
3. Wire `CollisionEngine.checkProgress()` into `SymbolEngine`'s `onDrawProgress` global listener.
4. Wire `CollisionEngine.checkNoGoZones()` and `checkPhaseLines()` into `onDrawEnd`.
5. Integrate `snapOutsideNoGoZone()` into `DrawingCueEngine._onCursorMove()`.
6. Add `checkFormationIntegrity()` call to `SelectionEngine "selectionChange"` handler.
7. Implement D8 rule registration pattern.
8. Wire `checkRoute()` for use by ScenarioEngine (B1, B3).
