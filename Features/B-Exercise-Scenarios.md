# B · Exercise Scenarios — Implementation Guide

## Overview

`ScenarioEngine` seeds the map with a tactical situation and evaluates the planner's response against success criteria. Like the plan system, every exercise is driven by a **JSON template** stored in `Templates/Ex/`. When the user activates a scenario and supplies a `PlacementArea`, ScenarioEngine transforms all normalized symbol coordinates into world positions and places the seed graphics automatically.

---

## Architecture

- **New file**: `MS/Engines/ScenarioEngine.ts` (singleton)
- **New file**: `MS/Engines/ReplayEngine.ts` (non-singleton)
- **Template folder**: `Templates/Ex/` — one JSON per exercise
- **Feature flag**: `Settings.json → features.scenarioEngine`

### Related files

| File | Role |
|------|------|
| `MS/Engines/ScenarioEngine.ts` | Engine singleton |
| `MS/Engines/ReplayEngine.ts` | Recording + playback |
| `Templates/Ex/logistic-convoy.json` | Logistic convoy exercise template |
| `Templates/Ex/ambush.json` | Ambush exercise template |
| `Templates/Ex/route-planning.json` | Route planning exercise template |

---

## Template System

### How exercise templates extend plan templates

Exercise templates share the same **placement coordinate system** as plan templates (see `A-Plan-System.md — Placement Coordinate System`). The key additions are:

1. **`locked`** flag on seed symbols — locked symbols cannot be moved or deleted by the planner.
2. **`scenarioProp`** block per symbol — carries scenario-specific metadata (threat zone radius, checkpoint id, forbidden zone flag).
3. **`successCriteria`** block at template root — defines what counts as passing.
4. **`scoring`** block at template root — defines score formula.
5. **`scenarioType`** at template root — identifies the exercise type for ScenarioEngine dispatch.

### PlacementArea (same as plan templates)

```jsonc
{
  "center":         { "longitude": 73.05, "latitude": 33.62 },
  "orientationDeg": 0,
  "units":          "kilometers",
  "frontage":       40,
  "depth":          30,
  "expandRatio":    1.0
}
```

Exercises typically use larger areas than plans (convoy routes, ambush kill zones).

---

### Exercise Template JSON Schema

```jsonc
{
  "id":           "logistic-convoy",
  "name":         "Logistic Convoy Test",
  "version":      "1.0",
  "description":  "Auto-places convoy route seed graphics and evaluates planner's route",
  "scenarioType": "logistic-convoy",

  "defaults": {
    "frontageKm":     40,
    "depthKm":        30,
    "orientationDeg": 0,
    "units":          "kilometers"
  },

  "symbols": [
    // Point seed — locked, cannot be moved by planner
    {
      "id":        "convoy-start",
      "symbolKey": "25331800",
      "role":      "convoy-start",
      "label":     "START",
      "geoType":   "Point",
      "position":  { "x": -0.8, "y": -0.8 },
      "locked":    true,
      "scenarioProp": {
        "isStartPoint":        true,
        "threatZoneRadiusKm":  0,
        "isCheckpoint":        false,
        "isForbiddenZone":     false
      },
      "amplifier": { "uniqueDesignation": "START" }
    },

    // Threat zone area — locked, forbidden zone
    {
      "id":        "threat-zone-1",
      "symbolKey": "25270706",
      "role":      "threat-zone",
      "label":     "THREAT",
      "geoType":   "Area",
      "rings": [
        [[-0.15, 0.0], [0.15, 0.0], [0.15, 0.3], [-0.15, 0.3], [-0.15, 0.0]]
      ],
      "locked": true,
      "style": {
        "fillColor":    [220, 30, 30],
        "fillOpacity":  0.25,
        "outlineColor": [180, 0, 0],
        "outlineWidth": 1.5
      },
      "scenarioProp": {
        "threatZoneRadiusKm": 3,
        "isForbiddenZone":    true,
        "forbiddenZoneId":    "threat-zone-1"
      }
    },

    // Checkpoint — locked point the planner's route must pass through
    {
      "id":        "checkpoint-a",
      "symbolKey": "25331800",
      "role":      "checkpoint",
      "label":     "CP-A",
      "geoType":   "Point",
      "position":  { "x": 0.3, "y": 0.1 },
      "locked":    true,
      "scenarioProp": {
        "isCheckpoint":  true,
        "checkpointId":  "checkpoint-A",
        "snapRadiusKm":  0.5
      },
      "amplifier": { "uniqueDesignation": "CP-A" }
    }
  ],

  "successCriteria": {
    "maxRouteLengthKm":    50,
    "forbiddenZoneIds":    ["threat-zone-1"],
    "requiredCheckpoints": ["checkpoint-A"],
    "timeLimitMinutes":    30
  },

  "scoring": {
    "baseScore":               100,
    "penaltyPerKmOver":        5,
    "penaltyForbiddenZone":    20,
    "penaltyMissedCheckpoint": 15,
    "passThreshold":           70
  }
}
```

#### Exercise-specific symbol entry fields

| Field | Type | Notes |
|-------|------|-------|
| `locked` | bool | `true` = planner cannot move/delete; skipped by SelectionEngine hitTest |
| `scenarioProp.isStartPoint` | bool | Route must originate here |
| `scenarioProp.isEndPoint` | bool | Route must terminate here |
| `scenarioProp.threatZoneRadiusKm` | number | Geodesic buffer radius for threat detection |
| `scenarioProp.isForbiddenZone` | bool | Triggers violation event if route crosses this area |
| `scenarioProp.forbiddenZoneId` | string | Referenced in `successCriteria.forbiddenZoneIds` |
| `scenarioProp.isCheckpoint` | bool | Route must pass within `snapRadiusKm` of this point |
| `scenarioProp.checkpointId` | string | Referenced in `successCriteria.requiredCheckpoints` |
| `scenarioProp.snapRadiusKm` | number | Detection radius for checkpoint clearing |
| `scenarioProp.ambushSectorBearingDeg` | number | For ambush scenarios — sector-of-fire bearing |
| `scenarioProp.ambushSectorHalfAngleDeg` | number | For ambush scenarios — half-angle of sector fan |
| `scenarioProp.ambushSectorRangeKm` | number | For ambush scenarios — sector range |

---

## Feature Specifications

### B1 — Logistic Test Scenario

**Template file**: `Templates/Ex/logistic-convoy.json`

**Symbols in template** (ratio space, defaults: 40 km frontage × 30 km depth):

| id | symbolKey | geoType | Role | Position / shape |
|----|-----------|---------|------|-----------------|
| `convoy-start` | `25331800` | Point | convoy-start | (−0.8, −0.8) — rear-left |
| `waypoint-1` | `25331800` | Point | waypoint | (−0.2, 0.0) |
| `waypoint-2` | `25331800` | Point | waypoint | (+0.3, +0.4) |
| `destination` | `25331800` | Point | convoy-end | (+0.7, +0.8) — forward-right |
| `checkpoint-a` | `25331800` | Point | checkpoint | (+0.0, +0.1) |
| `threat-zone-1` | `25270706` | Area | threat-zone | Centre band (x: ±0.15, y: 0.0–0.3) |
| `threat-zone-2` | `25270706` | Area | threat-zone | Right band (x: 0.5–0.8, y: 0.4–0.6) |

**Runtime behaviour**:
- Seed graphics placed on `"scenario-seed"` layer; `attributes.scenarioSeed = true`.
- `SelectionEngine` hitTest filter skips graphics with `attributes.scenarioSeed = true`.
- On each `onDrawEnd` during active scenario: call `MeasurementEngine.measureGraphic(graphic)` for distance and `CollisionEngine.checkRoute(graphic, threatZoneGraphics)` for forbidden zone detection.
- Threat zones: `geometryEngine.geodesicBuffer(threatPt, radiusKm * 1000, "meters")` then `geometryEngine.intersects(routeGeom, threatBuffer)`.
- Emit `"scenario-violation"` on each collision. Emit `"scenario-score-update"` after each leg.

---

### B2 — Ambush Exercise Scenario

**Template file**: `Templates/Ex/ambush.json`

**Symbols in template** (defaults: 20 km frontage × 15 km depth):

| id | symbolKey | geoType | Role | Position / shape |
|----|-----------|---------|------|-----------------|
| `kill-zone` | `25340100` | Area | kill-zone | Centre-forward (x: ±0.25, y: 0.3–0.7) |
| `ambush-pos-left` | `25141700` | Line | ambush-position | Left flank short line |
| `ambush-pos-right` | `25141700` | Line | ambush-position | Right flank short line |
| `blocking-pos-north` | `25340100` | Area | blocking-position | Forward-centre |
| `withdrawal-route` | `25330100` | Line | withdrawal-route | Rear extraction line |
| `friendly-entry` | `25331800` | Point | friendly-entry | Rear entry (0, −0.9) |

**Runtime behaviour**:
- Ambush position symbols with `scenarioProp.ambushSectorBearingDeg` get a **sector-of-fire arc** drawn automatically via `DrawingCueEngine.setOptions({ sectorOfFire: { enabled: true } })`.
- Arc fan computed from `ambushSectorBearingDeg`, `ambushSectorHalfAngleDeg`, `ambushSectorRangeKm` in the seed graphic's `scenarioProp`.
- Fan is a `Polygon` rendered on `"DrawingCueLayer"` as amber semi-transparent `SimpleFillSymbol`.
- Kill zone: `attributes.killZone = true`, red hatched fill.
- Scoring bonus: route that intersects kill zone gets "route through kill zone" flag in score event.

---

### B3 — Route Planning Test

**Template file**: `Templates/Ex/route-planning.json`

**Symbols in template** (defaults: 30 km frontage × 25 km depth):

| id | symbolKey | geoType | Role | Position / shape |
|----|-----------|---------|------|-----------------|
| `start-pt` | `25331800` | Point | route-start | (−0.8, −0.8) |
| `end-pt` | `25331800` | Point | route-end | (+0.6, +0.8) |
| `checkpoint-a` | `25331800` | Point | checkpoint | (−0.2, 0.0) |
| `checkpoint-b` | `25331800` | Point | checkpoint | (+0.2, +0.4) |
| `red-zone-1` | `25270706` | Area | forbidden-zone | Left-centre (x: −0.8 to −0.4, y: 0.0–0.5) |
| `red-zone-2` | `25270706` | Area | forbidden-zone | Right strip (x: 0.5–0.9, y: 0.2–0.7) |
| `time-gate` | `25140300` | Line | time-gate | Horizontal line at y = +0.5 |

**Runtime behaviour**:
- Red zones are `Area` symbols with `scenarioProp.isForbiddenZone = true`; rendered with red fill.
- On every `onDrawProgress`: `geometryEngine.intersects(currentGeom, redZonePolygon)` → emit `"scenario-violation"` (non-blocking).
- Checkpoint clearing: `geometryEngine.distance(checkpointPt, currentGeom) < scenarioProp.snapRadiusKm` → checkpoint cleared.
- Time limit: `setTimeout(() => ScenarioEngine.finish(), timeLimitMs)` on `ScenarioEngine.start()`.
- Live score displayed in HUD toast, updated on each `"scenario-score-update"` event.

---

### B4 — Scenario Playback / After-Action Replay

**Architecture**: `ReplayEngine.ts` — not a singleton; multiple recordings can coexist.

**Recording**:
- `startRecording()` — attaches listeners to `onDrawClick`, `onDrawProgress`, `onDrawEnd` on `document`.
- Each event stored as `{ timestamp: number, type: string, detail: any }` in `_events[]`.
- `exportRecording()` → JSON-serialisable object. `importRecording(json)` → restores.

**Playback**:
- `play()` — iterates events, `setTimeout(dispatch, event.timestamp − firstTimestamp)`.
- `pause()`, `stepForward()`, `stepBack()` — advance/rewind by one event index.
- `scrubTo(t)` — clears replay layer, replays all events with `timestamp ≤ t` synchronously.
- Scrub bar UI: `<input type="range">` mapped to `scrubTo(val * totalDuration)`.

**No template JSON**: replay is not scenario-specific. It records and replays any drawing session.

---

### B5 — Scenario Scoring / Assessment

**Score formula** (parameters from `template.scoring`):

```
score = baseScore
      − (excess_km × penaltyPerKmOver)
      − (forbidden_violations × penaltyForbiddenZone)
      − (missed_checkpoints × penaltyMissedCheckpoint)
score = max(0, score)
```

**Event emitted on `document`**: `"scenario-complete"`

```jsonc
{
  "scenarioId":        "logistic-convoy",
  "score":             78,
  "maxScore":          100,
  "passed":            true,
  "violations":        [{ "type": "forbidden-zone", "id": "threat-zone-1", "count": 1 }],
  "missedCheckpoints": [],
  "routeLengthKm":     52.3,
  "timeTakenSeconds":  420
}
```

**Results panel**: floating `<div>` shown on `"scenario-complete"` with score, breakdown, and pass/fail indicator. `ScenarioEngine.reset()` clears seed graphics and score but leaves planner's drawn symbols.

---

## Engine Integration Points

| Engine | Used for |
|--------|----------|
| `MeasurementEngine.measureGraphic()` | Leg/route distance evaluation |
| `CollisionEngine.checkRoute()` | Forbidden zone and threat zone detection |
| `DrawingCueEngine.setOptions({ sectorOfFire })` | Ambush sector-of-fire arc rendering |
| `GraphicsLayerManager.getOrCreateLayer("scenario-seed")` | Seed graphic placement |
| `SelectionEngine` hitTest filter | Excludes locked seed graphics from selection |

---

## Settings.json Additions

```jsonc
{
  "features": {
    "scenarioEngine": true,
    "replayEngine":   true
  },
  "scenarioEngine": {
    "defaultPassThreshold":    70,
    "checkpointSnapRadiusKm":  0.5
  }
}
```

---

## Implementation Order

1. Define `ExerciseTemplate`, `ScenarioSymbol`, `SuccessCriteria`, `ScoringConfig` interfaces.
2. Write `ScenarioEngine.ts`: `load()`, `start()`, `finish()`, `reset()`, `_liveScore()`.
3. Add `scenarioSeed` exclusion to `SelectionEngine` hitTest filter.
4. Add `sectorOfFire` option to `DrawingCueEngine`.
5. Create `Templates/Ex/logistic-convoy.json` with full symbol set.
6. Create `Templates/Ex/ambush.json` and `Templates/Ex/route-planning.json`.
7. Implement `ReplayEngine.ts`.
8. Build results panel UI.
