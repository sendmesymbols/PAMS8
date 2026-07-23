# Briefing Slide Editor — Design

**Date:** 2026-07-22
**Status:** Approved (frozen-slide editor · annotations only · ✎/double-click opens)

## Problem

Briefing slides are map-state snapshots (view, layer visibility, builds) with no
visual content of their own. Users want to open a slide full screen, annotate it
with PowerPoint-like tools (text, fonts, shapes, colors), and have those edits
persist into both **Export as PPTX** and the **deck JSON save**.

## Concept

Each slide gains an **overlay layer**: a list of slide-anchored annotation
objects stored on the `Slide` itself. Overlays therefore:

- persist in `saveBriefingToFile` / `exportBriefing` for free (slides round-trip whole),
- export to PPTX as native, individually-selectable PowerPoint objects (Mode A and B),
- never touch the map — the plan's ground truth is not forked. Map symbols are
  edited on the map (Morphix), not in the slide editor.

## Data model (`MS/Engines/Briefing/BriefingTypes.ts`)

```ts
export type OverlayKind = 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'freehand';

export interface SlideOverlay {
  id: string;
  kind: OverlayKind;
  /** Normalized [0..1] bounding box relative to the slide's view rect (top-left origin). */
  x: number; y: number; w: number; h: number;
  /** Degrees clockwise about the box center (text/rect/ellipse only). */
  rotation?: number;
  /** line/arrow: [start, end]; freehand: sampled polyline — normalized to the view rect. */
  points?: Array<{ x: number; y: number }>;
  fill?: string;            // '#RRGGBB'; undefined = no fill
  fillOpacity?: number;     // 0..1, default 1
  stroke?: string;          // '#RRGGBB'
  strokeWidth?: number;     // fraction of view HEIGHT (scales with export size)
  opacity?: number;         // whole-object 0..1
  // text only:
  text?: string;
  fontFamily?: string;
  fontSize?: number;        // fraction of view HEIGHT
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  textColor?: string;
}
```

- `Slide.overlays?: SlideOverlay[]` (absent = none).
- `BriefingDocument.version: 1 | 2` — export writes `2`; import accepts both
  (old decks load unchanged).
- **Normalized coordinates** are the contract: the same numbers position objects
  on the editor canvas (× canvas px) and in the PPTX (× contain-fit inches), so
  editor placement == PowerPoint placement. `strokeWidth`/`fontSize` normalize
  to view height (editor px = f × canvasH; pptx pt = f × fit.h × 72).

## Slide editor (`MS/Engines/Briefing/SlideEditor.ts` — new, dynamically imported)

Full-screen editor over a **frozen screenshot** of the slide, built on the
already-bundled **fabric.js 4.5** (`window.fabric`).

**Open** (✎ button on tile hover, or tile double-click — single click still
flies the map; prompt-rename is replaced by the editor's title field):

1. `applySlideForExport(index)` (jump, no animation) → `_settle` → full-res
   `takeScreenshot` (existing timeout-guarded pattern). On failure (3D headless):
   dark placeholder + warning banner; annotations still editable.
2. Full-screen stage (`z-index` above the briefing panel), letterboxed to the
   screenshot aspect; `fabric.Canvas` with the screenshot as background image.
3. Load `slide.overlays` → fabric objects (denormalize). Each fabric object
   carries `data: { id, kind }`.

**Toolbar:** Text · Rect · Ellipse · Line · Arrow · Freehand │ font family,
size, B/I/U, align │ fill color + opacity, stroke color + width │ duplicate,
delete, bring-forward/send-back │ editable slide **title** + **notes** │
**Save & Close** / Cancel. Style controls apply to the selection, else set the
defaults for the next-added object.

**Fabric mapping:** text → `fabric.Textbox`; rect → `Rect`; ellipse →
`Ellipse`; line → `Line`; arrow → `Group(Line, Triangle head)` (endpoints
recovered through the group transform on save); freehand → `PencilBrush` path,
serialized as sampled points.

**Keys:** capture-phase keydown while open (like present mode) — Esc = cancel,
Delete = remove selection — so app shortcuts never fire underneath.

**Save:** fabric objects → `SlideOverlay[]` (normalize), title/notes written
back, thumbnail regenerated **with annotations composited**
(`canvas.toDataURL` scaled to 240×135), strip refreshed. Cancel discards.

**Lifecycle guards:** refuse to open during present mode; `onViewChanged`
closes the editor (discard, log). Missing `window.fabric` → log error, no open.

## Present mode

While presenting, a slide's overlays render on a transparent
`fabric.StaticCanvas` stretched over the view (`pointer-events: none`),
drawn after the goTo transition completes and cleared on slide change / exit.
Static in v1 (no build animation coupling).

## PPTX integration (`MS/Engines/ImportExport/PptxExporter.ts`)

Mode B projects *map-anchored* graphics via `view.toScreen()` → contain-fit
inches. Overlays are *already screen-space*: they skip projection and reuse the
same fit mapping and helpers (`_colorParts`, dash/line props, `custGeom`).

- `exportDeck` passes `slide.overlays` into `_addSlide` meta; new
  `_emitOverlays(slide, overlays, fit)` runs after raster + Mode B shapes.
- **z-order = add order:** raster → Mode B geometry shapes → overlays → title
  (matches the editor).
- Emission: text → `addText` (font/size/color/align/bold/italic/underline,
  `rotate`); rect/ellipse → native shapes with fill/line/`rotate`;
  line/arrow → `custGeom` two-point path with `line.endArrowType: 'triangle'`
  for arrows; freehand → `custGeom` open path. Point-list kinds carry no
  `rotation` property — any rotation applied in the editor is baked into the
  saved points (recovered through the fabric transform matrix on save).
- Works in **Mode A and Mode B, 2D and 3D** (overlays emit natively even where
  Mode B falls back to flat raster). Explode-build sub-slides share their
  parent slide's overlays.

## Wiring

- `BriefingEngine.openSlideEditor(ref)` public API; tile ✎ + double-click.
- Ctrl+K action `briefing.editSlide` (edit current slide) registered alongside
  the existing briefing/export actions; API-panel button in `index.html` /
  `src/main.ts` kept in sync (project rule).
- No new settings in v1; everything stays behind `features.briefing`
  (export additionally behind `features.exportTools`, as today).

## Memory / size discipline

Full-res screenshots are captured **on demand only** (editor open, export) and
never stored in the deck JSON. Persisted cost per overlay is a few hundred
bytes; thumbnails stay 240×135.

## Files touched

| File | Change |
| --- | --- |
| `Briefing/BriefingTypes.ts` | `SlideOverlay`, `OverlayKind`, version `1 \| 2` |
| `Briefing/SlideEditor.ts` | **new** — full-screen fabric editor |
| `Briefing/BriefingEngine.ts` | ✎/dbl-click wiring, `openSlideEditor()`, present-mode overlay render, composited thumbnails |
| `ImportExport/PptxExporter.ts` | thread overlays through `_addSlide`, add `_emitOverlays` |
| `index.html` / `src/main.ts` | API-panel button + palette action sync |

## Error handling

- Screenshot failure → placeholder background, banner, editing still works.
- Invalid/unknown overlay entries on import → skipped with a log, never fatal.
- Shape-emit failures in PPTX → per-object try/catch (existing pattern), slide
  still exports.

## Testing

- `npm run build` (vite) green; `tsc` output filtered to touched files
  (baseline has pre-existing errors).
- Manual GUI (user-run dev server): capture 2D + 3D slides → annotate every
  kind → Save → verify strip thumbnail shows annotations → save deck JSON →
  reload deck → overlays intact → present mode shows overlays → export PPTX
  flat / editable / explode-builds → open in PowerPoint: annotations are
  native selectable objects above the map content.

## Out of scope (v1)

- Editing/moving the map symbols inside the slide editor (Morphix owns that).
- Animating overlays with build steps.
- Overlay display outside present mode / editor (no always-on map overlay —
  Pin to Screen already covers screen-anchored live-map content).
- Image/screenshot-crop overlay objects.
