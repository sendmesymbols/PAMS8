# I · Annotation & Label Intelligence — Implementation Guide

## Overview

These features extend `AnnotationEngine` with automatic decluttering (force-directed nudging), zoom-adaptive label density, callout boxes for persistent overlaps, and echelon-aware label priority. All features are applied as post-processing passes after each `AnnotationEngine.annotate()` call and after zoom/extent changes.

---

## Architecture

- All I features are implemented in `MS/Engines/AnnotationEngine.ts`.
- A new **declutter pass** method `AnnotationEngine.declutter()` is called after each `annotate()` and after each zoom change.
- **New option type**: `LabelDeclutterOptions` added to the `annotate()` signature.
- **Feature flags**: `Settings.json → features.labelDeclutter`, `features.adaptiveLabelDensity`, `features.labelCallout`, `features.labelPriority`.

---

## I1 — Force-Directed Label Placement

**What it does**: After each `annotate()` call, detect bounding-box overlaps among label graphics and run a spring-force iterative nudge to spread labels apart. A thin leader line connects each nudged label back to its symbol.

**Constraints**:
- **Bounding box computation**: each TextSymbol label has an approximate screen-space bounding box. Estimate from font size and text length: `width ≈ text.length * fontSize * 0.65`, `height ≈ fontSize * 1.4`. Convert from screen space to map space using `view.resolution` (map units per pixel).
- **Overlap detection**: for each pair of label graphics, check if their map-space bounding boxes overlap (`extents intersect`). Build a list of overlapping pairs.
- **Spring-force iteration**: run up to `maxIterations` (default 30) rounds:
  - For each overlapping pair (A, B): compute repulsion vector from A centre to B centre. Apply a fraction of the overlap distance as displacement to both labels in opposite directions.
  - Apply a weak attraction force pulling each label back toward its symbol's position (spring constant 0.1). This prevents labels from drifting too far.
  - Convergence: stop early if max displacement in a round < 1 map unit.
- **Leader line**: for each label whose position changed by more than `leaderLineThresholdPx` (default 10px in screen space) from the symbol centroid, add a thin `SimpleLineSymbol` Graphic from the symbol centroid to the label position. Style: 0.5px, grey `[180, 180, 180]`, solid.
- Leader line graphics are added to the `ANNOTATION_LAYER` with `attributes.isLeaderLine = true`. They are removed and recreated on each `declutter()` pass.
- **Performance limit**: run declutter only after `onDrawEnd` and after zoom changes (debounced 500ms). Do NOT run on every `onDrawProgress`. Limit to a maximum of 200 label graphics per pass (skip if more).
- **Stored positions**: after nudging, store the final nudged position in `graphic.attributes.nudgedPosition = { x, y }` so that `deAnnotate()` and re-annotation know where the label currently is.

---

## I2 — Adaptive Label Density by Zoom

**What it does**: At low zoom: SIDC icon only. At medium zoom: UNIQUE_DESIG only. At high zoom: full amplifier set. Thresholds configurable per plan type.

**Constraints**:
- **Density tiers** (configurable in `Settings.json → adaptiveLabelDensity.tiers`):
  ```json
  {
    "low":    { "maxZoom": 10, "fields": []                                              },
    "medium": { "maxZoom": 13, "fields": ["UNIQUE_DESIG"]                                },
    "high":   { "maxZoom": 99, "fields": ["UNIQUE_DESIG", "HIGHER_FORMATION", "DTG", "STAFF_COMMENTS", "ADDITIONAL_INFO"] }
  }
  ```
- **Implementation**: in `AnnotationEngine.annotate()`, before building the label text, determine the current tier from `view.zoom`. Filter the `Amplifier` fields to only include those in the current tier's `fields` array.
- **Re-annotation on zoom**: listen to `view.watch("zoom")` (debounced 300ms). On zoom change, call `AnnotationEngine.reannotateAll()` which iterates all graphics in FORCE/TACT layers, calls `deAnnotate()` then `annotate()` with the new tier's field set.
- **Per-plan-type tiers**: `PlanEngine.getLabelDensityTiers(planType)` overrides the default tiers. Call this if `PlanEngine` is available.
- **Guard**: do not reannotate if the tier hasn't changed from the previous zoom level.

---

## I3 — Auto Callout Boxes

**What it does**: When a label still overlaps another after the force-directed nudge pass (I1), automatically convert it to an ArcGIS callout `TextSymbol` with a thin leader line.

**Constraints**:
- A **callout TextSymbol** in ArcGIS JS is a `TextSymbol` with `callout` property:
  ```javascript
  new TextSymbol({
    text: labelText,
    callout: new LineCallout3D({ size: 0.5, color: calloutColour }),
    // OR for 2D MapView, use a background and border:
    backgroundColor: new Color([255, 255, 255, 0.85]),
    borderLineColor: new Color(calloutColour),
    borderLineSize: 1
  })
  ```
  Note: `LineCallout3D` is only for `SceneView`. For `MapView`, simulate a callout with `backgroundColor` and `borderLineColor` on the TextSymbol.
- **Trigger**: after the force-directed pass (I1), check remaining overlapping pairs. For any label that STILL overlaps, convert it to a callout symbol by replacing its `TextSymbol` with a callout-style `TextSymbol`.
- The callout leader is the leader line graphic added in I1. The callout symbol itself is placed at the nudged position.
- **Callout colour**: from `PlanEngine.getLabelOptions(planType)` (A9). Default: `[60, 60, 60]` (dark grey outline).
- **2D background box**: for `MapView`, use a TextSymbol with `backgroundColor = [255, 255, 255, 0.85]` and `borderLineColor = planColour` and `borderLineSize = 1`. This approximates a callout box without `LineCallout3D`.
- Only convert to callout if the label's text would be unreadable at the current zoom (i.e., if overlap percentage > 60%).

---

## I4 — Echelon-Aware Label Priority

**What it does**: Higher echelons (brigade, battalion) always win label real estate over lower ones (company, platoon) during the declutter pass.

**Constraints**:
- **Priority assignment**: before the force-directed pass (I1), assign a priority score to each label graphic:
  - Brigade: 4 (highest)
  - Battalion: 3
  - Company: 2
  - Platoon: 1
  - Unknown/tactical: 0 (lowest)
- Priority is derived from `graphic.attributes.drawEssentials.AMPLIFIER.SIDC` via `parseSIDC()`.
- **Modified spring-force behaviour**: when two labels overlap, the lower-priority label receives a stronger repulsion (its displacement is `1.5×` normal) while the higher-priority label receives `0.5×` displacement. Net effect: lower echelon labels are pushed away from higher echelon labels preferentially.
- **No-move zone**: brigade labels are never moved more than `maxNudgePx` (default 20px) from their original position. They effectively anchor in place and lower echelon labels must route around them.
- **Visibility enforcement**: if a low-priority label cannot be placed without overlapping a high-priority label after `maxIterations`, hide the low-priority label (`graphic.visible = false`). It reappears when the user zooms in enough for I2's higher tier to activate.

---

## `AnnotationEngine` Method Additions

```typescript
// New public methods:
static declutter(
  annotationLayer: GraphicsLayer,
  view: MapView | SceneView,
  options?: DeclutterOptions
): void;

static reannotateAll(
  targetLayers: GraphicsLayer[],
  annotationLayer: GraphicsLayer,
  view: MapView | SceneView,
  settingsData: any
): void;

// New interface:
interface DeclutterOptions {
  maxIterations?: number;       // default 30
  springConstant?: number;      // default 0.1
  leaderLineThresholdPx?: number; // default 10
  maxNudgePxHighPriority?: number; // default 20 (brigade)
  useCalloutOnPersistentOverlap?: boolean; // default true
}
```

---

## Settings.json Additions

```json
"features": {
  "labelDeclutter": true,
  "adaptiveLabelDensity": true,
  "labelCallout": true,
  "labelPriority": true
},
"adaptiveLabelDensity": {
  "debounceMs": 300,
  "tiers": {
    "low":    { "maxZoom": 10, "fields": [] },
    "medium": { "maxZoom": 13, "fields": ["UNIQUE_DESIG"] },
    "high":   { "maxZoom": 99, "fields": ["UNIQUE_DESIG", "HIGHER_FORMATION", "DTG", "STAFF_COMMENTS"] }
  }
},
"labelDeclutter": {
  "maxIterations": 30,
  "springConstant": 0.1,
  "leaderLineThresholdPx": 10,
  "maxGraphicsBeforeSkip": 200,
  "debounceMs": 500
}
```

---

## Implementation Order

1. Add `priority` computation to `AnnotationEngine.annotate()` — store in `graphic.attributes.labelPriority`.
2. Implement bounding-box overlap detection utility in `AnnotationEngine`.
3. Implement `declutter()` force-directed pass with echelon-weighted displacement (I1 + I4).
4. Add leader line graphic creation in `declutter()` (I1).
5. Add callout conversion for persistent overlaps (I3).
6. Implement `reannotateAll()` and wire to `view.watch("zoom")` (I2).
7. Integrate `PlanEngine.getLabelDensityTiers()` and `getLabelOptions()` into declutter (I2 + I3).
