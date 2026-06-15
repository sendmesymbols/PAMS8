# Threat Sector Panel — Design

**Date:** 2026-06-15
**Status:** Approved (design); pending implementation plan
**Author:** brainstorming session

## Goal

Give the **threat-sector tool** (`SectorDrawTool` + `VisualizationEngine.showSector`) a floating
control panel modelled on the existing **Bearing Compass Panel** (the self-hosted draggable widget
owned by `MagneticCompass`, opened via `DrawingCueEngine.openCompassWidget()`).

Today a threat sector can only be created by the interactive center→range→sweep draw, is always
hardcoded red at 30% fill, and the only management action is `clearSectors()` (nuke all). There is
no way to recolor, list, edit, or remove an individual sector, and no UI for any of it.

## Decisions (from brainstorming)

- **Scope: full parity** — appearance defaults, a *Draw Sector* button, numeric create, a live list
  of drawn sectors, and per-sector edit + remove + recolor.
- **Persistence: in-memory** — default-appearance state lives on `VisualizationEngine` and resets on
  page reload, matching the compass-panel reference. No `Settings.json` / `SettingsBus` wiring.
- **Open from multiple surfaces** (all call `symbolEngine.openSectorPanel()`):
  1. The existing right-click **"Add Threat Sector"** stays a *direct interactive draw* (unchanged).
  2. **Ctrl+K / ⚙ Settings menu** — an `action` entry in `VisualizationSettingsManifest.ts`.
  3. **Settings panel** — a button in the Visualization feature panel of `index.html`, wired through
     `src/main.ts`.
  4. **More Actions…** — a palette entry registered via `ContextMenuManager`, gated on the viz feature.
- **Scope boundary (non-goal):** per-sector editing is **numeric (range / start° / end°) + appearance
  (color / fill-opacity / outline-opacity / outline-width) only**. No interactive drag-handle editing
  of an existing sector's geometry — to re-place geometry, draw a fresh sector. Numeric *create* uses
  the current map center; precise placement is via the *Draw Sector* (click) flow.

## Reference pattern: the Bearing Compass Panel

`MagneticCompass` (child of `DrawingCueEngine`) owns both a sector/instance model and a self-hosted
HTML widget:

- Lifecycle: `openWidget()` → `_injectStyles()` + `_createWidget()` then show; `closeWidget()` hides;
  `_updateWidget()` re-renders contents; `_syncWidgetToSettings()` pushes engine state into controls;
  `destroy()` tears down. Panel is draggable via document `mousemove`/`mouseup` handlers.
- Surfaced via `DrawingCueEngine.openCompassWidget()` (auto-enables, broadcasts a `settingsChanged`,
  then opens), a `VisualizationSettingsManifest`-style `action` entry, and an `index.html` button
  (`#mc-open-widget-btn`, handler near `index.html:4840`).

We mirror the **widget shape**, but keep the panel in its own class so the already-large
`VisualizationEngine` does not absorb a big DOM block.

## Architecture

Three units, each independently understandable:

### 1. Sector model — `VisualizationEngine` (modify)

Currently `showSector` adds an anonymous polygon tagged `VIZ_TAG:"sector"`
(`VisualizationEngine.ts:978-1009`) and `clearSectors` removes everything so tagged
(`:1012`). Full-parity needs tracked instances.

Add:

- `interface SectorInstance { id: string; center: Point; rangeKm: number; azStartDeg: number;
  azEndDeg: number; color: [number,number,number]; fillOpacity: number; outlineOpacity: number;
  outlineWidth: number; label?: string; graphic: Graphic; }`
- `private _sectors: SectorInstance[] = []`
- In-memory **default appearance** fields, replacing the hardcoded literals at `:999-1000`:
  `_sectorDefaultColor=[220,50,50]`, `_sectorDefaultFillOpacity=0.30`,
  `_sectorDefaultOutlineOpacity=0.85`, `_sectorDefaultOutlineWidth=1.5`.
- New public API:
  - `createSector(center: Point|Graphic, opts): string` — normalizes center to a `Point`, fills
    unset appearance fields from defaults, builds the polygon (reuse `buildSectorRing`), tags the
    graphic, pushes a `SectorInstance`, returns its id.
  - `updateSector(id, patch): void` — merge patch, rebuild that instance's geometry + symbol.
  - `removeSector(id): void` — remove just that instance + its graphic.
  - `listSectors(): ReadonlyArray<{id,label,rangeKm,azStartDeg,azEndDeg,color,...}>` — for the panel.
  - `getSectorDefaults()` / `setSectorDefaults(patch)`.
- `showSector(...)` is kept as a thin wrapper over `createSector` (back-compat for existing callers).
- `clearSectors()` also empties `_sectors` (still clears any `sector-preview` too).
- `renderSectorPreview` / `clearSectorPreview` are unchanged — preview stays transient, not an instance.

### 2. `SectorPanel` — `MS/Engines/Visualization/SectorPanel.ts` (new)

Self-hosted draggable panel following the `MagneticCompass` widget structure:

- Constructor `(getView, viz: VisualizationEngine, symbolEngine-ish hooks)`. To start an interactive
  draw it calls `beginSectorDraw()`; reads/writes sectors through the `VisualizationEngine` API above.
- Methods: `open()`, `close()`, `destroy()`, `onViewChanged(view)`, `_injectStyles()`,
  `_createWidget()`, `_update()` (re-render the list + sync default-appearance controls).
- Contents:
  - **Draw Sector** button → `beginSectorDraw()` (interactive center→range→sweep; unchanged engine).
  - **Numeric create** — range km / start° / end° inputs + *Add* → `createSector(viewCenter, …)`.
  - **Default appearance** — color picker + fill-opacity / outline-opacity / outline-width; writes via
    `setSectorDefaults` so subsequent draws/creates pick them up.
  - **Sector list** — one row per `listSectors()` entry: label, recolor, opacity, numeric range/az
    edit, remove (→ `updateSector`/`removeSector`).
  - **Clear All** → `clearSectors()`.
- The panel re-renders (`_update()`) whenever it mutates the model. Because `SectorDrawTool` commits
  through `createSector`, **click-drawn sectors also appear in the list** the next time the panel
  updates (the panel refreshes on open and after its own actions; a committed draw while the panel is
  open triggers a refresh via the existing draw-end path — see Data flow).

### 3. Wiring — `SymbolEngine` (modify) + surfaces

- `SymbolEngine` instantiates `SectorPanel` next to `SectorDrawTool` (`SymbolEngine.ts:777`), routes
  `onViewChanged`, and exposes `openSectorPanel()` / `closeSectorPanel()` on the public API /
  `window.symbolEngine`.
- **Ctrl+K / Settings menu:** add an `action` entry to `VisualizationSettingsManifest.ts`
  (`path: ['visualization','sector','__openPanel']`, `type:'action'`,
  `buttonLabel:'🎯 Open Threat Sector Panel'`, `onClick` → `window.symbolEngine.openSectorPanel()`),
  matching `DrawingCuesSettingsManifest.ts:302`.
- **index.html Settings panel:** add a button (e.g. `#sector-open-panel-btn`) in the Visualization
  feature panel (`feature-panel-visualization`, ~`index.html:2198`), styled like `#mc-open-widget-btn`
  (`:1779`); click handler near `:4840` calls `window.symbolEngine.openSectorPanel()`. Expose the
  opener / command in `src/main.ts` alongside the other widget commands.
- **More Actions…:** add a `linkSectorPanel({ openPanel })`-style hook + palette entry in
  `ContextMenuManager.ts` (mirroring `linkTrafficabilityEngine` etc.), gated on
  `features.visualizationEngine === true`. `SymbolEngine` calls it during viz init.
- **"Add Threat Sector" context item is unchanged** — still `beginSectorDraw(graphic)`.

## Data flow

```
Open panel (any of 5 surfaces) ──► symbolEngine.openSectorPanel() ──► SectorPanel.open()
                                                                         │ reads listSectors()
                                                                         ▼
  ┌─ Draw Sector ──► beginSectorDraw() ──► SectorDrawTool (center→range→sweep)
  │                                            │ commit
  │                                            ▼
  │                                   VisualizationEngine.createSector() ──► _sectors[], graphic on _vizLayer
  ├─ Numeric Add ─► createSector(viewCenter, {range,azStart,azEnd, …defaults})
  ├─ Row edit ────► updateSector(id, patch) ──► rebuild geometry+symbol
  ├─ Row remove ──► removeSector(id)
  └─ Clear All ───► clearSectors()  (empties _sectors + removes graphics + preview)
                                              │
                                              ▼  SectorPanel._update() re-renders list
```

When a committed draw lands while the panel is open, the panel refreshes its list. The existing
draw pipeline already emits draw-end signals; the panel subscribes (or `createSector` notifies the
panel) so the new row appears without reopening. Exact notification mechanism is an implementation
detail for the plan (callback hook on `createSector` vs. listening to the existing event).

## View switch (2D ↔ 3D) and teardown

- `SectorDrawTool.onViewChanged` already cancels any in-progress draw — unchanged.
- `SectorPanel.onViewChanged` re-syncs (and is safe to call with no open draw). Cross-view rendering
  of committed sectors mirrors however `VisualizationEngine` already handles its other overlays on
  view change; this design does not add new cross-view persistence guarantees beyond that.
- `SectorPanel.destroy()` removes the widget, injected `<style>`, and document drag handlers — same
  discipline as `MagneticCompass.destroy()`.

## Files touched

| File | Change |
| --- | --- |
| `MS/Engines/Visualization/VisualizationEngine.ts` | Sector instance model + defaults + `createSector`/`updateSector`/`removeSector`/`listSectors`/`get/setSectorDefaults`; `showSector` → wrapper; `clearSectors` empties `_sectors`. |
| `MS/Engines/Visualization/SectorPanel.ts` *(new)* | Self-hosted draggable panel (compass-widget shape). |
| `MS/Engines/Visualization/SectorDrawTool.ts` | Commit routes through `createSector` (so drawn sectors are tracked). |
| `MS/Engines/SymbolEngine.ts` | Instantiate `SectorPanel`; `openSectorPanel()`/`closeSectorPanel()`; route `onViewChanged`; register More Actions hook. |
| `MS/Engines/VisualizationSettingsManifest.ts` | `action` entry → open panel (Ctrl+K / Settings menu). |
| `MS/Managers/ContextMenuManager.ts` | `linkSectorPanel` hook + palette entry (gated on viz feature). |
| `index.html` | Button in Visualization feature panel + click handler. |
| `src/main.ts` | Expose opener / add to widget command wiring. |

## Risks / notes

- **Primary risk:** the sector-instance refactor must not break the existing `showSector` callers
  (`SectorDrawTool`, the API passthrough on `SymbolEngine`). Mitigated by keeping `showSector` as a
  thin wrapper with identical signature.
- DOM/handler cleanup in `SectorPanel` (mirror `MagneticCompass.destroy()` exactly).
- No new dependencies. In-memory state only.
- Keep the panel's HTML/CSS lean — match the compass widget's footprint, don't gold-plate.
