# A · Plan System — Implementation Guide

## Overview

The Plan System introduces a `PlanEngine` module that acts as a **high-level orchestrator** above the existing engines. Each plan type (Defence, Attack, Logistic, Engineer, Comms) is driven by a **JSON template file** stored in `Templates/plans/`. When the user activates a plan and defines a placement area, PlanEngine loads that template and places all its symbols within the user-supplied envelope. Multiple plans may be open simultaneously as named overlay groups with independent opacity.

---

## Architecture & Module Placement

- **New file**: `MS/Engines/PlanEngine.ts` (singleton, same pattern as MeasurementEngine/ProximityEngine)
- **Template folder**: `Templates/plans/` — one JSON per plan type
- **Feature flag**: `Settings.json → features.planEngine`

### Related files

| File | Role |
|------|------|
| `MS/Engines/PlanEngine.ts` | Engine singleton |
| `Templates/plans/defence.json` | Defence plan symbol template |
| `Templates/plans/attack.json` | Attack plan symbol template |
| `Templates/plans/logistic.json` | Logistic plan symbol template |
| `Templates/plans/engineers.json` | Engineers plan symbol template |
| `Templates/plans/communications.json` | Comms plan symbol template |

---

## Template System

### What a template does

A plan template is a JSON file that declares every symbol the plan needs, each described as a set of normalized coordinates relative to a rectangular **placement envelope**. When the user activates a plan and supplies a `PlacementArea` (center point, frontage, depth, orientation), PlanEngine transforms all normalized coordinates into real-world geodetic positions and places the symbols.

### PlacementArea — user input

```json
{
  "center":         { "longitude": 73.05, "latitude": 33.62 },
  "orientationDeg": 0,
  "units":          "kilometers",
  "frontage":       20,
  "depth":          15,
  "expandRatio":    1.0
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `center` | Yes | Map click point — geodetic WGS-84 |
| `orientationDeg` | Yes | Bearing the "front" faces; 0 = North, 90 = East |
| `units` | Yes | `"meters"`, `"kilometers"`, `"miles"`, `"nautical-miles"` |
| `frontage` | Either this pair… | Width of the area in `units` |
| `depth` | …or expandRatio | Height/depth of the area in `units` |
| `expandRatio` | …or frontage+depth | Multiplies the template's `defaults.frontageKm` and `defaults.depthKm`; 1.0 = default size, 2.0 = double, 0.5 = half |

**Resolution rule**: if `frontage` + `depth` are provided they are used directly (after converting to km). If only `expandRatio` is provided it scales the template defaults. If both sets are provided, explicit frontage/depth wins.

---

### Placement Coordinate System

All symbol positions inside a template are expressed in **ratio space**:

```
                Front  (y = +1.0)
                    ↑
  Left (x = -1.0) ──┼── Right (x = +1.0)
                    │
               Center (0, 0)
                    │
                Rear  (y = -1.0)
```

- `x = -1.0` → left edge of frontage
- `x = +1.0` → right edge of frontage
- `y = +1.0` → forward / front edge
- `y = -1.0` → rear edge
- Origin `(0, 0)` is the user-supplied center point

**World coordinate transform** (flat-Earth approximation; valid for extents < 200 km):

```
dx_km = x × (frontageKm / 2) × expandRatio
dy_km = y × (depthKm   / 2) × expandRatio

θ (rad) = orientationDeg × π / 180

ΔNorth = dy_km × cos(θ) − dx_km × sin(θ)
ΔEast  = dy_km × sin(θ) + dx_km × cos(θ)

Δlat = ΔNorth / 111.32
Δlon = ΔEast  / (111.32 × cos(center.lat × π / 180))

finalLon = center.lon + Δlon
finalLat = center.lat + Δlat
```

Applied per-vertex for Line and Area symbols; applied to the single `position` for Point/FPoint symbols.

---

### Template JSON Schema

```jsonc
{
  "id":          "defence",
  "name":        "Defence Plan",
  "version":     "1.0",
  "description": "Standard defensive plan overlay",

  "defaults": {
    "frontageKm":     20,
    "depthKm":        15,
    "orientationDeg": 0,
    "units":          "kilometers"
  },

  "symbols": [
    // Point / FPoint symbol
    {
      "id":        "reserve-hq",
      "symbolKey": "30180000",
      "role":      "Reserve",
      "label":     "RES",
      "geoType":   "FPoint",
      "position":  { "x": 0.0, "y": -0.5 },
      "style":     { "size": 20 },
      "amplifier": { "uniqueDesignation": "RES" }
    },

    // Line symbol
    {
      "id":        "feba",
      "symbolKey": "25140300",
      "role":      "FEBA",
      "label":     "FEBA",
      "geoType":   "Line",
      "path": [
        { "x": -1.0, "y":  0.85 },
        { "x": -0.3, "y":  0.90 },
        { "x":  0.3, "y":  0.88 },
        { "x":  1.0, "y":  0.85 }
      ],
      "style": {
        "color":     [220, 30, 30],
        "lineStyle": "dash",
        "width":     2.5
      },
      "amplifier": { "uniqueDesignation": "FEBA" }
    },

    // Area symbol
    {
      "id":        "bp-alpha",
      "symbolKey": "25340100",
      "role":      "BattlePosition",
      "label":     "BP ALPHA",
      "geoType":   "Area",
      "rings": [
        [[-1.0, 0.50], [-0.15, 0.50], [-0.15, 0.85], [-1.0, 0.85], [-1.0, 0.50]]
      ],
      "style": {
        "fillColor":    [0, 112, 0],
        "fillOpacity":  0.12,
        "outlineColor": [0, 90, 0],
        "outlineWidth": 1.5
      },
      "amplifier": { "uniqueDesignation": "BP ALPHA" }
    }
  ]
}
```

#### Symbol entry fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | Yes | Unique within template; used as graphic attribute |
| `symbolKey` | string | Yes | Key from `MS/Data/Symbols.json` |
| `role` | string | Yes | Semantic role (FEBA, PhaseLine, Reserve, etc.) |
| `label` | string | No | Displayed as annotation/amplifier |
| `geoType` | string | Yes | Must match symbol class capability: `"Point"`, `"FPoint"`, `"Line"`, `"Area"` |
| `position` | `{x,y}` | For Point/FPoint | Normalized coordinates |
| `path` | `[{x,y}…]` | For Line | Ordered vertices in normalized coordinates |
| `rings` | `[[[x,y]…]…]` | For Area | Polygon rings in normalized coordinates |
| `style` | object | No | Visual overrides (color, width, opacity) |
| `amplifier` | object | No | Annotation data (uniqueDesignation, higherFormation, DTG) |

#### `style` sub-fields

| Field | Applies to | Type | Notes |
|-------|-----------|------|-------|
| `color` | Line | `[r,g,b]` | RGB 0–255 |
| `lineStyle` | Line | string | `"solid"`, `"dash"`, `"dot"`, `"dash-dot"` |
| `width` | Line | number | Pixels |
| `fillColor` | Area | `[r,g,b]` | RGB 0–255 |
| `fillOpacity` | Area | number | 0–1 |
| `outlineColor` | Area | `[r,g,b]` | RGB 0–255 |
| `outlineWidth` | Area | number | Pixels |
| `size` | Point/FPoint | number | Symbol render size in pixels |

#### `geoType` compatibility with `MS/Data/Symbols.json`

| Symbols.json `SymGeoType` | Template `geoType` |
|---------------------------|---------------------|
| `"Line"` | `"Line"` |
| `"Area"` | `"Area"` |
| `"Point"` | `"Point"` |
| `"FPoint"` | `"FPoint"` |

---

## Plan-Type Template Files

### Reference symbol keys (from `MS/Data/Symbols.json`)

| Key | Name | SymGeoType | Plan use |
|-----|------|-----------|---------|
| `25140300` | Phase Line | Line | FEBA, FLOT, PL, LD/LC |
| `25140301` | Counter Attk Obj | Line | Objective line |
| `25141700` | Ambush | Line | Ambush exercise |
| `25151406` | Axis Of Advance For Feint | Area | Attack axis |
| `25270706` | Minefield - Unspecified | Area | Obstacle belt, minefield |
| `25271100` | Bridge - Gap | Line | Bridging site (line) |
| `25320200` | Ammo Sup Pt | Point | Supply point |
| `25320300` | Ammo Transfer Pt | Point | Transfer point |
| `25321200` | R3P (Rearm/Refuel/Resupply) | Point | Logistic point |
| `25330100` | Moving Convoy / Approach | Line | MSR/ASR route, convoy |
| `25331800` | Waypoint | Point | Waypoints, checkpoints |
| `25340100` | Block | Area | Battle position, engagement area |
| `25340200` | Breach | Area | Breach point area |
| `25340300` | Bypass | Area | Bypass route area |
| `10110207` | Land Eqpt - Node Cen | FPoint | Comms node |
| `10111001` | Sig - Radio | FPoint | Radio station |
| `10111002` | Sig - Radio Relay | FPoint | Radio relay |
| `15130100` | Engr Bridge | FPoint | Bridging site (point) |
| `20120601` | Ammo Depot | FPoint | Logistic base |
| `20121426` | Breaching Sec | FPoint | Breach team position |
| `30180000` | Reserves | FPoint | Reserve position |

---

## Feature Specifications

### A1 — Defence Plan Template

**Template file**: `Templates/plans/defence.json`

**Symbols in template** (all coordinates in ratio space):

| id | symbolKey | geoType | Role | Approximate position |
|----|-----------|---------|------|---------------------|
| `feba` | `25140300` | Line | FEBA | y ≈ +0.85 (forward edge) |
| `flot` | `25140300` | Line | FLOT | y ≈ +0.50 |
| `pl-alpha` | `25140300` | Line | PL ALPHA | y ≈ −0.40 (rear) |
| `pl-bravo` | `25140300` | Line | PL BRAVO | y ≈ +0.95 (forward) |
| `bp-alpha` | `25340100` | Area | BattlePosition | Left sector (x: −1 to −0.15, y: 0.5–0.85) |
| `bp-bravo` | `25340100` | Area | BattlePosition | Right sector (x: +0.15 to +1.0, y: 0.5–0.85) |
| `engagement-area` | `25340100` | Area | EngagementArea | Centre-forward (x: ±0.4, y: 0.85–1.0) |
| `obstacle-belt` | `25270706` | Area | ObstacleBelt | Thin strip at y ≈ +0.82–+0.88 |
| `reserve` | `30180000` | FPoint | Reserve | Centre-rear (0, −0.5) |
| `minefield-left` | `25270706` | Area | Minefield | Left flank (x: −1.0 to −0.65, y: 0.88–0.95) |

**Constraints**:
- All symbols carry `attributes.planType = "defence"` and `attributes.templateId = <id>`.
- Template graphics are placed as editable overlays — the planner can reshape them.
- `DrawingCueEngine` slope cues are enabled on plan activation.
- `MeasurementEngine` units default to `meters`.

---

### A2 — Attack Plan Template

**Template file**: `Templates/plans/attack.json`

**Symbols in template**:

| id | symbolKey | geoType | Role | Approximate position |
|----|-----------|---------|------|---------------------|
| `ld-lc` | `25140300` | Line | LD/LC | y = −0.8 (start line) |
| `pl-alpha` | `25140300` | Line | PL ALPHA | y = −0.3 |
| `pl-bravo` | `25140300` | Line | PL BRAVO | y = +0.3 |
| `objective` | `25140301` | Line | Objective | y = +0.85 |
| `axis-main` | `25151406` | Area | AxisOfAdvance | Centre strip (x: ±0.25) full depth |
| `axis-sp` | `25151406` | Area | SupportingAxis | Right strip (x: 0.5–1.0) full depth |
| `assault-pos` | `25340100` | Area | AssaultPosition | (x: ±0.3, y: 0.75–0.90) |

**Constraints**:
- MeasurementEngine auto-computes SP (y=−0.8) to each phase line distance on activation.
- March-time label appended: `"X km · Yh Zm @ speedKmh km/h"`.
- `MeasurementEngine.setOptions({ show_total: true, speedKmh: settings.marchSpeedKmh })` called on activation.

---

### A3 — Logistic Plan Template

**Template file**: `Templates/plans/logistic.json`

**Symbols in template**:

| id | symbolKey | geoType | Role | Approximate position |
|----|-----------|---------|------|---------------------|
| `msr-main` | `25330100` | Line | MSR | Full frontage, y: −0.8 to +0.8 |
| `asr-left` | `25330100` | Line | ASR | Left branch |
| `log-base` | `20120601` | FPoint | LogisticBase | Centre-rear (0, −0.7) |
| `supply-pt-1` | `25320200` | Point | SupplyPoint | Left of centre (−0.5, 0.0) |
| `supply-pt-2` | `25320200` | Point | SupplyPoint | Right of centre (+0.5, 0.0) |
| `r3p-main` | `25321200` | Point | R3P | Centre (0, +0.3) |
| `ammo-hold` | `20120601` | FPoint | AmmoHoldingArea | Rear-left (−0.5, −0.8) |

**Constraints**:
- On each `onDrawEnd` for any polyline symbol with `attributes.planType === "logistic"`, PlanEngine calls `geometryEngine.geodesicBuffer()` to render a corridor overlay (default 2 km wide, configurable via `settings.planEngine.corridorWidthKm`).
- March time is always shown on logistic routes.

---

### A4 — Engineers Plan Template

**Template file**: `Templates/plans/engineers.json`

**Symbols in template**:

| id | symbolKey | geoType | Role | Approximate position |
|----|-----------|---------|------|---------------------|
| `route-main` | `25330100` | Line | RouteClassification | Full depth |
| `bridge-site` | `15130100` | FPoint | BridgingSite | Forward (0, +0.7) |
| `breach-1` | `25340200` | Area | BreachArea | Left-forward (x: −1.0 to −0.7, y: 0.8–1.0) |
| `breach-sec` | `20121426` | FPoint | BreachSection | At breach entry point |
| `obstacle-1` | `25270706` | Area | ObstacleArea | Forward belt |
| `bridge-gap` | `25271100` | Line | BridgeGap | Centre-forward |

**Constraints**:
- Slope/gradient cues are force-enabled: `DrawingCueEngine.setOptions({ rubberBand: { showSlope: true } })`.
- Bridging site placement queries `ElevationLayer` and stores elevation in `graphic.attributes.elevation`.

---

### A5 — Communication Plan Template

**Template file**: `Templates/plans/communications.json`

**Symbols in template**:

| id | symbolKey | geoType | Role | Approximate position |
|----|-----------|---------|------|---------------------|
| `hq-node` | `10110207` | FPoint | CommNode | Centre (0, 0) |
| `relay-north` | `10111002` | FPoint | RadioRelay | Forward-centre (0, +0.6) |
| `relay-left` | `10111002` | FPoint | RadioRelay | Left (−0.6, +0.2) |
| `relay-right` | `10111002` | FPoint | RadioRelay | Right (+0.6, +0.2) |
| `radio-rear` | `10111001` | FPoint | RadioStation | Rear (0, −0.7) |

**Constraints**:
- On placement of each symbol with `role === "CommNode"` or `role === "RadioRelay"`, PlanEngine calls `TerrainEngine.runLOS(point, radiusKm)` automatically.
- LOS result is rendered on a `"plan-comms-los"` layer.

---

### A6 — Plan Switcher with Overlay Merge

No template JSON changes. The plan switcher UI manages:
- Per-plan GraphicsLayer group: `plan_overlay_<type>`, `plan_symbols_<type>`, `plan_annotations_<type>`
- Per-plan opacity slider (`setPlanOpacity(type, 0–1)`)
- Per-plan visibility toggle (`setPlanVisible(type, bool)`)
- Stacking order: COMMS (top) → ATTACK → DEFENCE → LOGISTIC → ENGINEERS (bottom)
- Event `"plan-switcher-change"` emitted on change.

---

### A7 — Plan-Type SIDC Filter

`PlanEngine.getFocusPlanSidcPrefixes()` returns the `prioritySidcPrefixes` from the focused plan config. SymbolEngine subscribes to `"plan-type-change"` and calls this to filter/reorder the palette.

---

### A8 — Rapid Symbol Palette by Plan Type

On `"plan-type-change"`, the palette UI reads `PlanEngine.focusPlanSidcPrefixes` and pins those symbols to a "Recommended" group header. User drag-and-drop reordering within "Recommended" persists to `localStorage`.

---

### A9 — Per-Plan-Type Label Colour

`AnnotationEngine.annotate()` accepts a `labelOptions.textColor` field. PlanEngine passes the plan's `accentColor` as `textColor` via `AnnotationEngine.annotate(... , { textColor: [r, g, b] })` during `_onSymbolCreated`.

---

## Engine Integration Points

| Engine | Called by PlanEngine |
|--------|----------------------|
| `DrawingCueEngine.setOptions()` | On plan activation — configures slope cues, corridor bands |
| `MeasurementEngine.setOptions()` | Sets march speed and preferred units per plan type |
| `AnnotationEngine.annotate()` | Receives `labelOptions.textColor` from PlanEngine |
| `GraphicsLayerManager.getOrCreateLayer()` | Creates per-plan named layers |
| `TerrainEngine.runLOS()` | Triggered after comms node placement |
| `geometryEngine.geodesicBuffer()` | Buffer on logistic route draw end |

---

## Settings.json Additions

```jsonc
{
  "features": {
    "planEngine": true
  },
  "planEngine": {
    "defaultMarchSpeedKmh": 5,
    "corridorWidthKm": 2,
    "defaultOrientationDeg": 0,
    "defaultPlan": null
  }
}
```

---

## Event Contract

All dispatched on `document` as `CustomEvent`:

| Event | Detail |
|-------|--------|
| `plan-type-change` | `{ planType: PlanType \| null, previous: PlanType \| null }` |
| `plan-activated` | `{ type, config, activePlan, placementArea }` |
| `plan-deactivated` | `{ type }` |
| `plan-focus-changed` | `{ type }` |
| `plan-switcher-change` | `{ activePlans: string[], opacityMap: Record<string, number> }` |
| `plan-overlays-seeded` | `{ planType, symbolCount, overlayLayer }` |
| `echelon-visibility-changed` | `{ zoom, echelon }` |

---

## Implementation Order

1. Define `PlacementArea`, `TemplateSymbol`, `PlanTemplate` interfaces in `PlanEngine.ts`.
2. Write `_ratioToWorld(x, y, area)` coordinate transform utility.
3. Write `loadTemplate(path)` and `placeTemplate(template, area, layer)` methods.
4. Create `Templates/plans/defence.json` with complete symbol set.
5. Create remaining plan template JSONs (attack, logistic, engineers, communications).
6. Implement `PlanEngine.activatePlan()` to prompt for `PlacementArea` then call `placeTemplate`.
7. Add `labelOptions.textColor` to `AnnotationEngine.annotate()`.
8. Implement `MeasurementEngine.formatMarchTime()` helper.
9. Build plan switcher UI component.
10. Wire `PlanEngine` into `SymbolEngine._initPlanEngine()`.
