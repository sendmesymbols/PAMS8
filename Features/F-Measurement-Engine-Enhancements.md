# F · Measurement Engine Enhancements — Implementation Guide

## Overview

This section extends the existing `MeasurementEngine` with military-specific measurement modes: azimuth variants (grid/magnetic/true), NATO mils, march-time estimation, fuel/logistic consumption, artillery range fans, cross-country mobility rating, and a cumulative statistics panel. All changes are backward-compatible additions to the existing `MeasurementEngine.ts` singleton.

---

## Architecture

- All F features are implemented **inside** `MS/Engines/MeasurementEngine.ts`.
- New methods and options are added to the existing `MeasurementOptions` interface and `MeasurementEngine` class.
- New dependencies: IGRF magnetic declination model (lightweight JS library or lookup table) for F1.
- New event: `"measurement-march-update"` for march-time/fuel HUD updates.

---

## F1 — Grid / Magnetic / True Azimuth

**What it does**: Extend `_bearing()` with magnetic declination from the IGRF model or user input. Emit `gridAzimuth`, `magneticAzimuth`, and `trueAzimuth` on `"measurement-update"`.

**Constraints**:
- **Grid azimuth**: the current bearing output from `_bearing()` (measured from grid north, which for Web Mercator / WGS84 projected maps = true north at the central meridian). For practical purposes, grid azimuth = true azimuth for small extents.
- **True azimuth**: bearing measured from true geographic north. For Web Mercator (WKID 3857), apply a convergence correction: `trueAzimuth = gridAzimuth - meridianConvergence`. Meridian convergence in degrees: `convergence = lon_degrees × sin(lat_radians)` (approximation valid for mid-latitudes).
- **Magnetic azimuth**: `magneticAzimuth = trueAzimuth - magneticDeclination`. Declination source:
  - Option A (preferred): embed a minimal IGRF lookup table (WMM2025 simplified coefficients for 5°×5° grid). Query by lat/lon and interpolate. Store as `MS/Data/WMM.json`.
  - Option B (fallback): user manually enters declination in HUD settings. Store in `MeasurementEngine._userDeclination: number` (degrees East positive).
- **New fields in `MeasurementSnapshot`**: `gridAzimuth: string`, `magneticAzimuth: string`, `trueAzimuth: string`.
- **New option**: `MeasurementOptions.show_all_azimuths?: boolean`. When true, all three azimuths are shown in the segment label.
- Label format: `"1.4 km  Grid: N45°E  Mag: N47°E  True: N45°E"`.

---

## F2 — Military Angular Units (Mils)

**What it does**: Add NATO mils alongside degrees for all bearing outputs. User-selectable in the HUD.

**Constraints**:
- 1 degree = 17.7778 NATO mils (6400 mils per full circle).
- Conversion: `mils = degrees × (6400 / 360)`.
- New option: `MeasurementOptions.angular_unit?: "degrees" | "mils"`. Default: `"degrees"`.
- When `angular_unit = "mils"`, all bearing outputs replace the degree string with mils: `"1500 mils"`.
- Both units can optionally be shown simultaneously: `MeasurementOptions.show_both_angular_units?: boolean`. Format: `"N45°E (800 mils)"`.
- Mils format: always show as integer (round to nearest mil). No decimal places for mils.
- Emit `angular_unit` in the `"measurement-update"` event detail so the HUD can format its display.

---

## F3 — March-Time Estimator

**What it does**: `speedKmh` option appends ETA to the total-length label. Updates live as polyline grows. Supports wheeled, tracked, and foot-march presets.

**Constraints**:
- New option: `MeasurementOptions.speedKmh?: number`. When > 0, march time is computed and appended.
- March time formula: `timeH = totalLengthKm / speedKmh`. Format: hours and minutes — `"2h 50m"`. If < 1 hour: `"50m"`. If ≥ 24 hours: `"1d 2h"`.
- Full label format: `"14.2 km · 2h 50m @ 5 km/h"`.
- Speed presets (configurable in `Settings.json → measurementEngine.marchPresets`):
  ```json
  {
    "foot":    { "label": "Foot March",    "speedKmh": 5  },
    "wheeled": { "label": "Wheeled",       "speedKmh": 40 },
    "tracked": { "label": "Tracked",       "speedKmh": 25 }
  }
  ```
- New public method: `MeasurementEngine.setMarchSpeed(preset: string | number)`. Accepts a preset name or direct km/h value.
- March time is appended to the total-length label (`_tGraphic`). The `_tGraphic` TextSymbol text is updated to include the march time string.
- Emit `marchTime: string` in the `"measurement-update"` event detail.

---

## F4 — Fuel / Logistic Consumption

**What it does**: Multiply route length by a user-set fuel-consumption rate and display estimated fuel requirement alongside march time.

**Constraints**:
- New option: `MeasurementOptions.fuelConsumptionLkm?: number` (litres per km). When > 0, fuel estimate is computed.
- Fuel formula: `fuelL = totalLengthKm × fuelConsumptionLkm`.
- Fuel display appended to total-length label: `"14.2 km · 2h 50m · 28.4L"`.
- Fuel presets in `Settings.json → measurementEngine.fuelPresets`:
  ```json
  {
    "lightVehicle": { "label": "Light Vehicle", "lkm": 12 },
    "heavyVehicle": { "label": "Heavy Vehicle", "lkm": 25 },
    "tank":         { "label": "Tank",           "lkm": 80 }
  }
  ```
- New public method: `MeasurementEngine.setFuelRate(preset: string | number)`.
- Emit `fuelEstimateL: number` in the `"measurement-update"` event detail.
- **Integration with PlanEngine (A3)**: when `activePlanType === "LOGISTIC"`, `PlanEngine` auto-calls `MeasurementEngine.setFuelRate("heavyVehicle")` and `setMarchSpeed("wheeled")`.

---

## F5 — Artillery Range Fan Measurement

**What it does**: When an artillery SIDC is active, switch to range-fan mode: display minimum/maximum range arcs and dead-zone cone, updating live as the symbol is moved.

**Constraints**:
- Trigger: `SymbolEngine` calls `MeasurementEngine.setRangeFanMode(profile: WeaponProfile | null)` on `initialize()` when the active SIDC matches a weapon profile with `minRangeKm` and `maxRangeKm`.
- Range fan graphics added to `measurementGraphicsLayer`:
  1. **Max range arc**: `geometryEngine.geodesicBuffer(symbolPt, maxRangeKm * 1000, "meters")` — dashed circle, red outline.
  2. **Min range arc** (dead zone inner boundary): `geometryEngine.geodesicBuffer(symbolPt, minRangeKm * 1000, "meters")` — dashed circle, amber outline.
  3. **Dead-zone cone**: if `deadZoneDeg > 0`, subtract a sector from the full circle to show the cone directly behind the weapon.
- The range fan is re-rendered on every `onDrawProgress` event (symbol moves with cursor).
- Range fan is cleared on `wrapUp()` / `onDrawEnd`.
- A TextSymbol label shows `"Min: 3km  Max: 25km"` above the max range circle.
- Emit `rangeFanMode: true`, `minRangeKm`, `maxRangeKm` in `"measurement-update"`.

---

## F6 — Cross-Country Mobility Rating

**What it does**: Combine slope data (from TerrainEngine) with a user-supplied soil-type layer to output go/no-go/slow-go per route segment. Displayed as a colour-banded line.

**Constraints**:
- **Mobility classification** per segment:
  - `"go"`: slope < 8% AND soil passability = "firm" → green
  - `"slow-go"`: slope 8–15% OR soil passability = "soft" → amber
  - `"no-go"`: slope > 15% OR soil passability = "impassable" → red
- Soil-type layer: a `GraphicsLayer` or `FeatureLayer` ID configured in `Settings.json → measurementEngine.soilTypeLayerId`. Each feature has `attributes.soilPassability: "firm"|"soft"|"impassable"`.
- **Computation**: for each route segment (between control points), query `TerrainEngine.getSlopeForSegment()` (async) and `geometryEngine.intersects(segmentLine, soilPolygon)` for each soil polygon. Combine results.
- **Rendering**: split the route Polyline into per-segment graphics. Each segment's `SimpleLineSymbol` colour reflects its mobility rating. Replace the `_lineGraphic` with an array of segment graphics.
- Computation is async and runs after each new control point is added (`addSegment()`). Results update when promises resolve.
- Emit `mobilityRatings: [{ segmentIndex, rating }]` in `"measurement-update"`.

---

## F7 — Cumulative Statistics Panel

**What it does**: A persistent floating panel while drawing multi-segment routes. Shows segment length, total length, bearing, elevation delta, slope %, march time, and fuel estimate.

**Constraints**:
- This is primarily a **UI component**, not an engine change. The panel subscribes to `"measurement-update"` events and renders all available fields.
- Panel ID: `"measurement-stats-panel"`. Positioned fixed to the bottom-right of the map container.
- Visible only while drawing (`DrawingCueEngine` active). Listen to `"drawing-cue-state-change"` event.
- Fields displayed (hide field rows where data is not available):

  | Field | Source |
  |-------|--------|
  | Segment Length | `segmentLength` |
  | Total Length | `totalLength` |
  | Bearing (Grid/Mag/True) | `gridAzimuth`, `magneticAzimuth`, `trueAzimuth` |
  | Elevation Δ | From TerrainEngine async query |
  | Slope % | From TerrainEngine async query |
  | March Time | `marchTime` |
  | Fuel Estimate | `fuelEstimateL` |
  | Mobility Rating | `mobilityRatings` |

- Panel is collapsible (click title to collapse). State persists in `localStorage`.
- Panel has a unit selector (m/km/nm, deg/mils) that calls `MeasurementEngine.setOptions({ dist_unit, angular_unit })` live.

---

## Updated `MeasurementOptions` Interface

```typescript
interface MeasurementOptions {
  // ... existing fields ...
  show_all_azimuths?: boolean;
  angular_unit?: "degrees" | "mils";
  show_both_angular_units?: boolean;
  speedKmh?: number;
  fuelConsumptionLkm?: number;
  use3DDistance?: boolean;  // from C7
}
```

---

## Updated `MeasurementSnapshot` Interface

```typescript
interface MeasurementSnapshot {
  // ... existing fields ...
  gridAzimuth: string;
  magneticAzimuth: string;
  trueAzimuth: string;
  marchTime?: string;
  fuelEstimateL?: number;
  rangeFanMode?: boolean;
  mobilityRatings?: { segmentIndex: number; rating: "go"|"slow-go"|"no-go" }[];
}
```

---

## Settings.json Additions

```json
"measurementEngine": {
  "defaultAngularUnit": "degrees",
  "showBothAngularUnits": false,
  "userMagneticDeclinationDeg": null,
  "marchPresets": {
    "foot":    { "label": "Foot March",  "speedKmh": 5  },
    "wheeled": { "label": "Wheeled",     "speedKmh": 40 },
    "tracked": { "label": "Tracked",     "speedKmh": 25 }
  },
  "fuelPresets": {
    "lightVehicle": { "label": "Light Vehicle", "lkm": 12 },
    "heavyVehicle": { "label": "Heavy Vehicle", "lkm": 25 },
    "tank":         { "label": "Tank",           "lkm": 80 }
  },
  "soilTypeLayerId": null
}
```

---

## Implementation Order

1. Add `gridAzimuth`/`magneticAzimuth`/`trueAzimuth` to `_bearing()` and `MeasurementSnapshot` (F1).
2. Add `angular_unit` mils conversion to all bearing outputs (F2).
3. Add `speedKmh` march-time computation to total-length label (F3).
4. Add `fuelConsumptionLkm` computation (F4).
5. Implement `setRangeFanMode()` and range fan graphics (F5).
6. Implement F6 mobility rating with TerrainEngine integration.
7. Build F7 statistics panel UI component.
