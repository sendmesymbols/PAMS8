# M · Export & Briefing Tools — Implementation Guide

## Overview

These features allow the planner to export the current map state as a static image, a KML file, or an interactive briefing presentation, bridging the gap between planning and execution.

---

## Architecture

- **New file**: `MS/Engines/ExportEngine.ts` (singleton)
- **Dependencies**: `html2canvas` (or ArcGIS native `view.takeScreenshot()`), XML builder for KML.
- **Feature flag**: `Settings.json → features.exportTools`

---

## M1 — High-Resolution Image Export

**What it does**: Captures the map extent with all drawn symbols and overlays, including HUD elements if desired, to a PNG/JPEG.

**Constraints**:
- **ArcGIS Screenshot**: use `view.takeScreenshot({ width, height, format })`. This captures map layers but NOT HTML HUD overlays (like StatPanel or Toasts).
- **HUD Capture**: if HUD inclusion is needed, temporarily render HUD data into canvas elements over the map, or use an external library like `html2canvas` on the main container. Usually, clean map exports (no HUD) are preferred.
- **Print Layout**: optionally overlay a title block, legend, and scale bar on the exported image.
- **Download**: trigger browser download: `const link = document.createElement('a'); link.href = screenshot.dataUrl; link.click();`.

---

## M2 — KML / GeoJSON Export

**What it does**: Exports the drawn graphics into standard geospatial formats for use in other systems (e.g., Google Earth, ATAK).

**Constraints**:
- **GeoJSON**: natively supported. Iterate all graphics, call `arcgisToGeoJSON(graphic.geometry)`, append attributes.
- **KML**: requires translating ArcGIS symbology to KML `<Style>` tags. For `milsymbol` PictureMarkerSymbols, extract the PNG data-URL and embed it in the KML `<Icon>` tag, or host the icons and link to them.
- `ExportEngine.exportToGeoJSON()` and `ExportEngine.exportToKML()`.
- Trigger download of the resulting text string as a blob.

---

## M3 — Briefing Mode (Slide Presentation)

**What it does**: Create "slides" that store specific map extents, visible layers, and active time-phases. The user can click "Next" to fly smoothly between them like a PowerPoint presentation.

**Constraints**:
- **Slide Data Model**: `{ id: string, title: string, extent: Extent, visibleLayers: string[], timePhaseMs: number }`.
- **Capture**: UI button "Capture Slide" saves current `view.extent`, active plan layer visibility, and `TemporalEngine.currentTime` to a list in `ExportEngine._slides`.
- **Playback**: UI panel with Prev/Next buttons. Clicking Next calls `view.goTo(slide.extent, { duration: 1000 })`, applies layer visibility, and sets `TemporalEngine` time.
- **Export Slides**: serialise `_slides` array to JSON so the briefing can be saved and shared.

---

## M4 — Auto-Generated Legend

**What it does**: Scans all visible graphics and builds a dynamic legend panel showing symbol icons and their descriptions.

**Constraints**:
- **Generation**: iterate FORCE/TACT layers. Extract unique SIDCs.
- **Rendering**: call `SymbolEngine.getSymbolForSIDC()` to get the image. Look up the description from SIDC metadata (e.g., "10031000" -> "Infantry").
- **UI Component**: floating HTML panel `MS/HUD/LegendPanel.ts`. Updates dynamically when layers are toggled or new symbols are drawn.

---

## Settings.json Additions

```json
"features": { "exportTools": true },
"exportTools": {
  "defaultExportFormat": "png",
  "includeLegendInExport": true
}
```

---

## Implementation Order

1. Implement `ExportEngine.ts` with `takeScreenshot()` (M1).
2. Implement GeoJSON/KML data formatting and download (M2).
3. Build Legend Panel UI component (M4).
4. Implement Briefing Mode slide capture and playback (M3).
