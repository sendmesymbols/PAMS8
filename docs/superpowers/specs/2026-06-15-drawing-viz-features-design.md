# Design — Three Drawing / Visualization Features

**Date:** 2026-06-15
**Status:** Approved (design); pending spec review
**Scope:** Three independent, well-bounded additions to the PAMS8 MS library. All reuse
existing engines, layers, and helpers; no new dependencies.

---

## Goals & Non-Goals

**Goals**

1. **Threat/Engagement Sector** — let a planner draw a geodesic wedge (engagement arc)
   centered on a point symbol, interactively (set range + sweep the two edges on the map).
2. **Subtract Lasso** — an `Alt+L` lasso that *removes* enclosed symbols from the current
   selection, to refine a large multi-selection.
3. **Polygon Close-Cue** — a visual "close ring" shown over the first vertex while drawing a
   polygon, so the user can land a clean close. Guidance only.

**Non-Goals**

- No auto-ending of polygon draws and no per-symbol draw-loop edits (close-cue is purely an
  additive overlay in DrawingCueEngine).
- No numeric/dialog sector entry (interactive draw was chosen).
- No new export, persistence, or settings subsystems beyond a single boolean flag.

---

## Feature 1 — Threat/Engagement Sector

### 1.1 Core render method (headless, testable)

Add to `MS/Engines/Visualization/VisualizationEngine.ts`:

```ts
public showSector(
  center: Point | Graphic,
  opts: {
    rangeKm: number;
    azStartDeg: number;
    azEndDeg: number;
    color?: [number, number, number];   // default [220, 50, 50]
    opacity?: number;                    // default 0.30
  },
): void
public clearSectors(): void
```

- Resolves a `Point` from `center` (if a `Graphic`, use its `geometry`; abort if not a point).
- Builds a **wedge polygon ring**: `[center, arcPt(azStart), … sampled every ~2° …, arcPt(azEnd), center]`
  where each `arcPt(az) = GeoTools.destination(center, rangeKm, az, "kilometers")`.
- Sweep direction follows `azStart → azEnd` in the direction the user dragged (see 1.3); the
  sampled azimuth sequence is generated in that direction so a sector crossing 0°/360° renders
  correctly.
- Adds a `Graphic` with `SimpleFillSymbol` (fill `color`+`opacity`, solid outline at 0.85 alpha,
  width 1.5) to `_vizLayer`, tagged `attributes: { [VIZ_TAG]: "sector" }`.
- `showSector` does **not** clear prior sectors (multiple sectors may coexist); `clearSectors()`
  removes all graphics tagged `"sector"`, mirroring `clearThreatFan()`.

**Edge cases:** non-point/no geometry → return (no throw); `rangeKm <= 0` → return; degenerate
arc (`azStart === azEnd`) → return. Azimuths normalized to `[0, 360)` before sampling.

### 1.2 Interactive controller

New small class `MS/Engines/Visualization/SectorDrawTool.ts` — kept separate so the render
method stays pure/testable and the interaction state is isolated.

```ts
class SectorDrawTool {
  constructor(getView: () => MapView | SceneView | null, viz: VisualizationEngine);
  begin(center?: Point | Graphic): void;  // seed center, enter draw mode
  cancel(): void;
  onViewChanged(view): void;               // cancel + drop handlers
}
```

State machine:

| Step | Trigger | Action |
|------|---------|--------|
| `IDLE → SET_RANGE` | `begin(center)` | resolve & store center; attach `pointer-move` + `click` handlers; show preview |
| `SET_RANGE` | pointer-move | `rangeKm = geodesic dist(center, cursor)`, `azStart = bearing(center, cursor)`; redraw preview wedge with a thin 1° placeholder arc |
| `SET_RANGE → SWEEP` | click | lock `rangeKm`, `azStart` |
| `SWEEP` | pointer-move | `azEnd = bearing(center, cursor)`; redraw preview wedge `azStart → azEnd` in drag direction |
| `SWEEP → DONE` | click | `viz.showSector(center, { rangeKm, azStartDeg, azEndDeg })`; tear down |
| any | `Escape` key / right-click | cancel; clear preview; tear down |

- Preview is a single reused `Graphic` on `_vizLayer` tagged `"sector-preview"` (dashed outline),
  removed on finalize/cancel.
- Range (km) = `geometryEngine.geodesicLength(new Polyline({ paths: [[[centerLon, centerLat],
  [cursorLon, cursorLat]]], spatialReference }), "kilometers")` — `geometryEngine` and `Polyline`
  are already imported in VisualizationEngine, so this needs no new import. Bearing via
  `GeoTools.bearing(center, cursor)`.
- Handlers (`view.on("pointer-move")`, `view.on("click")`, document `keydown` for Escape) are
  stored and removed on finalize/cancel/`onViewChanged` — no leaks.

### 1.3 Surfacing

- `ContextMenuManager` item registered for point graphics: **"Add threat sector"** →
  `sectorDrawTool.begin(graphic)`.
- `VisualizationEngine.showSector` / `clearSectors` and a `beginSectorDraw(graphic?)` shim
  exposed on `window.symbolEngine` for the API Test panel.
- `SectorDrawTool` instantiated by `SymbolEngine` (alongside the other viz wiring) and routed
  through its `onViewChanged`.

---

## Feature 2 — Subtract Lasso (Alt+L)

### 2.1 SelectionEngine

- Extend `lassoSelect(opts?, onComplete?)` `opts` with `subtract?: boolean`.
- On `create` complete:
  - **subtract**: do *not* clear selection; for each hit graphic call `deselectGraphic(g)`.
  - non-subtract: unchanged (existing add/replace behavior).
- Use a distinct **red** fill symbol `LASSO_SUBTRACT_SYM` when `subtract` is true (visually
  separates "removing" from the normal additive lasso).
- Add `deselectGraphic(graphic: Graphic): void` — look up id, remove highlight, delete from
  `_selected`, emit `selectionChange`. (Pairs with existing `selectGraphic`.)
- Empty current selection + subtract → no-op, emit an EngineLogger hint.

### 2.2 KeyboardShortcutManager

In the `case 'l'/'L'` block:

```
if (e.altKey) {
  if (selectionEngine.isLassoActive) selectionEngine.cancelLasso();
  else selectionEngine.lassoSelect({ subtract: true });
} else {
  // existing plain-L behavior unchanged
}
```

Help/shortcut table comment updated to document `Alt+L`.

---

## Feature 3 — Polygon Close-Cue (DrawingCueEngine)

### 3.1 Behavior

- In `updateFromProgress(geom, ctrlPts)`: if `geom?.type === "polygon"` and
  `ctrlPts.length >= 3`, store `_closeFirstVertex = ctrlPts[0]` and arm the cue; otherwise
  disarm and clear any close-ring (covers lines and early polygon vertices).
- In the existing `_boundPointerMove` path: if armed, project the first vertex and the cursor to
  screen (`view.toScreen`), compute pixel distance; if `<= CLOSE_PX` (16) draw/update a
  **close-ring** indicator `Graphic` at the first vertex on `_layer`; else remove it.
- The cue **never** ends the draw or changes geometry — the user still double-clicks to close.
- Cleared on `deactivate()` and on draw-end (same lifecycle as the other cue overlays).

### 3.2 Settings

- Add `drawingCues.closeCue: boolean` (default `true`) to `Settings.json`; gate the cue on it via
  the existing settings flow. When off, the arm step is skipped.

---

## Cross-cutting

- **Layers/tags:** sector + preview live on the existing `_vizLayer` (`VIZ_TAG`); close-ring on
  DrawingCueEngine's `_layer`; subtract lasso on `_LassoLayer`. No new layers.
- **View switch:** `SectorDrawTool.onViewChanged` cancels any in-progress draw; DrawingCueEngine
  and SelectionEngine already handle `onViewChanged`.
- **No new dependencies.**

## Testing / Verification

- **Headless unit check (sector geometry):** call `showSector` with known
  `center/rangeKm/azStart/azEnd`; assert the ring is closed, vertex count ≈ arc span / 2° + 2,
  and the first/last arc vertices' bearings from center equal `azStart`/`azEnd` within tolerance.
  Also assert a sector crossing 0°/360° produces a contiguous wedge.
- **Manual (`npm run dev`, user-run):**
  - Sector: right-click a point symbol → "Add threat sector" → drag range, click, sweep, click;
    Escape mid-draw cancels cleanly. API-panel `showSector`/`clearSectors`.
  - Subtract lasso: select several symbols, `Alt+L`, enclose a few → they drop from selection;
    red lasso visual; plain `L` still adds.
  - Close-cue: draw a polygon, approach the first vertex → close-ring appears within ~16px and
    clears when moving away; line symbols show no ring; toggle `drawingCues.closeCue` off → no ring.
- **Type-check:** `tsc -p tsconfig.build.json` filtered to changed files shows no *new* errors
  (pre-existing baseline errors ignored).

## Rollout / Risk

- Three independent changes; can land/verify one at a time. Lowest-risk first: subtract lasso →
  close-cue → sector (the only one adding an interactive controller).
- Primary risk is handler cleanup in `SectorDrawTool`; mitigated by storing every handle and
  tearing down on finalize/cancel/view-switch.
