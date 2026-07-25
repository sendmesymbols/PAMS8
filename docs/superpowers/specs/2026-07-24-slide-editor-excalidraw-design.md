# Slide Editor — Excalidraw-style Rework (Design)

Date: 2026-07-24 · Status: approved (user chose layout/shapes/undo in chat) · Scope: `MS/Engines/Briefing` + PPTX import/export

## Goal

Rework the Briefing SlideEditor's chrome and controls in the style of excalidraw.com:
slim top tool strip with shortcut badges + a floating contextual properties panel,
plus copy/paste, laser pointer, fill controls, layering, line styles, shape shortcuts,
and more shapes. No new dependencies — fabric.js 4.5 CDN global, pptxgenjs bundle,
vanilla injected DOM/CSS, exactly as today.

## Layout

- **Top strip** (tools, grouped by separators, each with a shortcut corner badge):
  select V/1, lasso S · rect R/2, diamond D/3, ellipse O/4, triangle Y, star X,
  callout C · line L/6, arrow A/5, draw P/7, highlighter H, text T/8 · eraser E/0,
  laser K — then title input, notes toggle, ◀ n/m ▶ nav, slideshow, Save & Close, Cancel.
- **Floating properties island** (top-left over canvas): shown when a draw tool is
  active (edits defaults) or a selection exists (edits it live). Contextual sections:
  Stroke swatches+custom · Fill swatches+none+custom · Fill opacity · Stroke width
  S/M/L+numeric · Stroke style solid/dashed/dotted · Text (font/size/B/I/U/align) ·
  Object opacity · Layers (to-back/backward/forward/to-front) · Actions (duplicate/delete).
- Icons: small inline SVGs (no dependency).

## New overlay kinds

| Kind | Fabric render | PPTX shape | Persistence |
|---|---|---|---|
| `diamond` | Polygon from bbox | `diamond` | like rect (bbox+rotation+fill/stroke) |
| `triangle` | fabric.Triangle | `triangle` | like rect |
| `star` | 5-point Polygon (inner r = 0.382) | `star5` | like rect |
| `callout` | round-rect + tail Path | `wedgeRoundRectCallout` | like rect |
| `highlight` | wide Polyline, opacity ≈ 0.45, round caps | existing custGeom path + transparency | like freehand + opacity |

Callout compromise: fabric 4.5 cannot edit text inside a group, so drawing a callout
creates the bubble then auto-spawns a normal centered text overlay already in edit
mode. Two independent objects (multi-select to move together).

New field `strokeDash?: 'dashed' | 'dotted'` on `SlideOverlay` (absent = solid) →
fabric `strokeDashArray` scaled by width; PPTX `dashType` dash/sysDot. Document
version stays 4: old readers already skip unknown kinds gracefully.

## Editor-only tools (never persisted)

- **Lasso (S)**: freehand region; on release selects objects whose centers fall
  inside (fabric.ActiveSelection), then reverts to select tool.
- **Eraser (E/0)**: drag deletes objects under the pointer; stays active.
- **Laser (K)**: fading red trail rendered on fabric `contextTop` via rAF;
  ~1 s decay ported from Excalidraw `laserTrails.ts` easing; cleared on tool exit.

## Behaviors

- **Clipboard** Ctrl+C/X/V, Ctrl+D duplicate. Stored as normalized `SlideOverlay[]`
  (reuses `fabricToOverlay`/`overlayToFabric`) module-level → paste works across
  slides. Paste offsets +16 px, selects result.
- **Undo/redo** Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. JSON snapshots of the overlay list
  committed after each completed mutation; capped at 50; resets on slide navigation.
- **Layering** Ctrl+] / Ctrl+[ / Ctrl+Shift+] / Ctrl+Shift+[ + panel buttons.
- **Nudge** arrows 1 px, Shift+arrows 10 px.
- **Escape ladder**: exit text editing → revert to select tool → clear selection →
  close editor (was: instant close).

## Files

- `BriefingTypes.ts` — OverlayKind + 5 kinds, `strokeDash`.
- `OverlayFabric.ts` — shape factories (shared with present mode), dash round-trip.
- `SlideEditor.ts` — tool registry, canvas logic, keyboard map, clipboard, undo,
  lasso, eraser, laser integration.
- `SlideEditorUI.ts` (new) — chrome DOM/CSS + selection↔panel sync.
- `LaserTrail.ts` (new) — trail renderer.
- `PptxExporter.ts` — new shape map, highlight routing, dashType.
- `PptxImporter.ts` — reverse prst mapping (diamond/triangle/star5/wedge*Callout),
  prstDash → strokeDash.

Present mode (`BriefingEngine`) renders via `overlayToFabric` generically — no change.
No harness changes (editor reached through existing Briefing UI). Verification:
`npm run build` (vite) + tsc filtered to touched files + manual GUI per project norms.
