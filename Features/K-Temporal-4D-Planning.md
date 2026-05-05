# K · Temporal / 4D Planning — Implementation Guide

## Overview

Temporal Planning adds a "time" dimension to the map. Every graphic has a valid start and end time (DTG - Date Time Group). A timeline slider at the bottom of the screen allows the planner to scrub forward and backward in time, showing only the graphics valid at that specific moment.

---

## Architecture

- **New file**: `MS/Engines/TemporalEngine.ts` (singleton)
- **Feature flag**: `Settings.json → features.temporalEngine`
- **Data model**: `graphic.attributes.dtgStart` and `graphic.attributes.dtgEnd` (UNIX timestamps).
- **UI Component**: `MS/HUD/TimelineSlider.ts`.

---

## K1 — Graphic Lifespan (DTG)

**What it does**: Assigns time windows to symbols. A unit might be at Phase Line Alpha at H+2, and Phase Line Bravo at H+4.

**Constraints**:
- **Assignment**: on draw, read DTG from `drawEssentials.AMPLIFIER.DTG`. Parse the DTG string into a JS Date timestamp. Store in `graphic.attributes.dtgStart`. `dtgEnd` defaults to `null` (valid indefinitely).
- If a unit moves (e.g., copied/pasted to a new location for a later phase), the old graphic gets `dtgEnd` set to the new graphic's `dtgStart`.
- `TemporalEngine.setGraphicLifespan(graphic, startMs, endMs)`.

---

## K2 — Timeline Scrubber UI

**What it does**: A horizontal slider UI showing the span of the current plan. Scrubbing the slider updates the map to reflect that time.

**Constraints**:
- **Component**: fixed to bottom of map, full width.
- **Extent**: `min` = earliest `dtgStart` of all graphics. `max` = latest `dtgStart` + 24 hours.
- **Scrubbing**: on `input` event from the slider, `TemporalEngine.setCurrentTime(timestamp)` is called.
- **Filtering logic**: `TemporalEngine` iterates all graphics in FORCE/TACT layers. `graphic.visible = (currentTime >= dtgStart && (dtgEnd === null || currentTime < dtgEnd))`.
- Overrides H1/H2 visibility logic: if a graphic is hidden by K2, it stays hidden regardless of zoom/echelon. If visible by K2, H1/H2 rules then apply.

---

## K3 — Phase Playback / Animation

**What it does**: Automatically animates the timeline slider from start to end, showing the flow of the battle.

**Constraints**:
- Play/Pause buttons next to the timeline slider.
- `TemporalEngine.play(speedMultiplier)`. `speedMultiplier` determines how many simulation minutes pass per real-time second (e.g., 60x = 1 hour per minute).
- Uses `requestAnimationFrame` to smoothly increment `currentTime` and apply visibility filtering.

---

## K4 — Ghosting Future/Past Positions

**What it does**: Instead of making out-of-time symbols completely invisible, render them as faint "ghosts" so the planner can see the unit's path over time.

**Constraints**:
- **Toggle**: `Settings.json → temporalEngine.showGhosts`.
- **Logic**: if `currentTime < dtgStart` (future position) or `currentTime >= dtgEnd` (past position), instead of `graphic.visible = false`, set `graphic.symbol.opacity = 0.2` (for PictureMarkerSymbol) and apply a greyscale filter. Add a dotted movement line connecting the past -> current -> future positions of the same unit.

---

## Settings.json Additions

```json
"features": { "temporalEngine": true },
"temporalEngine": {
  "showGhosts": true,
  "defaultDurationHours": 24
}
```

---

## Implementation Order

1. Implement `TemporalEngine.ts` core time filtering logic.
2. Build `TimelineSlider.ts` UI component and bind to TemporalEngine.
3. Add DTG parsing and assignment on `onDrawEnd` in `SymbolEngine`.
4. Implement Playback loop (K3).
5. Implement Ghosting logic (K4).
