# O · Briefing PPTX Import & Capture-into-Slide — Design

## Overview

Two additions to the Briefing module (`MS/Engines/Briefing/`):

1. **O1 — PPTX Import**: an "Import PPTX" option on the Briefing panel that parses a
   `.pptx` file and creates briefing slides from its content — text, shapes, pictures,
   tables (flattened) and speaker notes — mapped into the existing `SlideOverlay`
   model so imported content is immediately editable in the Slide Editor and
   round-trips natively back out through `PptxExporter`.
2. **O2 — Capture into Slide**: a second capture button beside "＋ Add Slide".
   "Add Slide" keeps its current behavior (new slide from the map). The new
   "📷 Capture into Slide" re-shoots the current map and places the image **beneath
   all the slide's existing elements** (overlays/text), updating the slide's view
   state and thumbnail while keeping title, notes, annotations and builds.

Decisions confirmed with the user (2026-07-24):

- Capture UX: **two explicit buttons** (additive; Add Slide unchanged).
- Tables: **flatten to a text overlay** (rows as lines, cells `" | "`-separated).
- Pictures: **composite all pictures into the slide background raster** (document order).
- Import merge: **append** after existing slides (never destructive).

## Key technical fact

`pptxgenjs` is **write-only** — it cannot parse `.pptx`. But a `.pptx` is a ZIP of
OOXML, and our offline bundle `MS/ThirdParty/PptxGenJS/pptxgen.bundle.js` already
assigns **`window.JSZip`** as a global (verified — the bundle opens with the JSZip
UMD). So import needs **zero new dependencies**: reuse the existing script-tag
loader, unzip with `window.JSZip`, parse XML with the browser's native `DOMParser`.

---

## Architecture

- **New file**: `MS/Engines/ImportExport/PptxImporter.ts` — pure parser, sibling of
  `PptxExporter.ts`. Exposes `parsePptx(data: ArrayBuffer, opts): Promise<{ slides: Slide[]; warnings: string[] }>`.
  Dynamically imported by `BriefingEngine` on first use (same pattern as SlideEditor)
  so no parse code loads until an import actually happens.
- **`PptxExporter.ts`**: export the module-private `loadPptxGenJS()` helper so the
  importer reuses the same script-tag load (which also provides `window.JSZip`).
- **`BriefingEngine.ts`**: new `importPptxFromFile()` (file picker → parser → append),
  new `captureIntoSlide(ref?)`, two toolbar buttons, plus three small behavior tweaks
  for "screen-only" slides (see O1.4).
- **Feature flag**: none new — everything rides on the existing `features.briefing`
  gate (the panel only exists when briefing is enabled).

**Screen-only slides**: an imported slide has no map state — `view: { capturedIn: <current> }`
with neither `extent` nor `camera`, and `visibleLayers: {}`. `_resolveGoToTarget`
already returns null for that shape, so playback simply doesn't move the map.
`BriefingDocument.version` bumps to 4 (4 = slides may be screen-only); import
accepts 1–4.

---

## O1 — PPTX Import

**Flow**

1. New Briefing toolbar button **"⬆ Import PPTX"** (`data-act="importPptx"`) →
   `importPptxFromFile()`: `<input type="file" accept=".pptx">` → `File.arrayBuffer()`
   → dynamic-import `PptxImporter` → `loadPptxGenJS()` → `JSZip.loadAsync(buffer)`.
2. Parsed slides are **appended** to `_slides`, strip refreshed, panel popped open,
   Engine Log summary: `N slides imported, M elements skipped (…)` + warnings.

**OOXML parsing** (namespace-tolerant — match on `localName`, prefixes vary)

- `ppt/presentation.xml`: `p:sldSz@cx,cy` (EMU; 914400/inch) → slide dimensions;
  `p:sldIdLst` order + `ppt/_rels/presentation.xml.rels` → ordered slide parts.
- Per `ppt/slides/slideN.xml` (+ its `_rels` for media/notes), walk `p:spTree`
  in document order:
  - **`p:sp` title placeholder** (`p:ph@type` = `title`/`ctrTitle`) → `slide.title`
    (NOT an overlay — the exporter re-draws titles natively, keeping round-trips clean).
  - **`p:sp` with text** → `text` overlay. Box from `a:xfrm` (`a:off`, `a:ext`),
    rotation from `@rot` (÷ 60000). Paragraphs joined `\n`, runs concatenated; style
    from the first run's `a:rPr`: `sz`/100 → pt, bold/italic/underline, `solidFill/srgbClr`
    → `textColor`, paragraph `algn` → align. If the same `sp` also has a visible
    fill/outline with `prstGeom` rect/ellipse, emit the shape overlay first, then the
    text overlay above it.
  - **`p:sp` `prstGeom`** `rect`/`roundRect` → `rect`; `ellipse` → `ellipse`.
    Fill `a:solidFill/a:srgbClr` (+`a:alpha` → `fillOpacity`), outline `a:ln`
    (`@w` EMU, solidFill) → `stroke`/`strokeWidth`.
  - **`p:sp` `a:custGeom`** → `freehand` overlay: walk `a:pathLst/a:path`
    (`a:moveTo`/`a:lnTo` points scaled by the path's `@w`/`@h` into the shape box).
    This is exactly what our own exporter emits for lines/areas/freehand — so
    export → import round-trips shape geometry.
  - **`p:cxnSp`** (`line`/`straightConnector*`) → `line` overlay; endpoints from the
    xfrm box honoring `@flipH`/`@flipV`; `a:ln/a:tailEnd@type` triangle/arrow → `arrow`.
  - **`p:pic`** → decode `a:blip@r:embed` target from `ppt/media/*` (base64 via JSZip)
    and **composite onto the background canvas** at its xfrm box.
  - **`p:graphicFrame` / `a:tbl`** → flatten to a `text` overlay at the frame box:
    rows (`a:tr`) as lines, cells (`a:tc`) joined with `" | "`. Warn in Engine Log.
  - **`p:grpSp`** → recurse, mapping child coords through the group transform
    (`a:off`/`a:ext` vs `a:chOff`/`a:chExt` linear map).
  - Anything else → skipped, counted in the warnings summary.
- **Notes**: slide rel → `ppt/notesSlides/notesSlideN.xml`, text of the `body`
  placeholder → `slide.notes`.
- **Normalization** (matches the exporter's inverse exactly):
  `x = off.x / sldSz.cx`, `w = ext.cx / sldSz.cx` (same for y/h);
  `fontSize = pt / (slideH_in × 72)`; `strokeWidth = w_EMU / sldSz.cy`.
- **Background canvas**: always produced — canvas at ~1280px wide, slide aspect;
  filled with `p:bg` solid color when present (else white, the PowerPoint default);
  pictures composited in document order; exported as jpeg q80 → `backgroundDataUrl`;
  scaled 240px copy → `thumbnailDataUrl`.

**O1.4 — screen-only slide behavior (3 tweaks in BriefingEngine)**

1. `_editorHost().prepareBackground`: slide with no `extent`/`camera` but a
   `backgroundDataUrl` → return the stored background directly (no map apply,
   no screenshot). Editor shows the imported deck content.
2. `_renderPresentOverlays`: for screen-only slides, draw `backgroundDataUrl`
   contain-fit on the present StaticCanvas **beneath** the overlays (present mode
   currently only draws overlays).
3. `PptxExporter._addSlide`: for a screen-only slide, use the slide's
   `backgroundDataUrl` as the image instead of a fresh map screenshot, and skip
   Mode-B convertible collection (there is no map state to project).

## O2 — Capture into Slide

**What it does**: updates the **current** slide in place — the freshly captured map
image goes beneath the slide's existing annotations; title/notes/overlays/builds are
kept. Answers "when new vs. existing": the user chooses explicitly via two buttons;
the only fallback is **no current slide → behaves like Add Slide** (logged).

**Implementation**

- Factor the map-state snapshot out of `captureSlide()` into a private
  `_snapshotMapState(): { view, visibleLayers, graphicVisibility }` used by both paths.
- `captureIntoSlide(ref?: number | string): Slide | null`:
  - Target `ref ?? _current`; if none → `captureSlide()`.
  - Overwrite `view`, `visibleLayers`, `graphicVisibility`; keep everything else.
  - Refresh `backgroundDataUrl` via `_tryFullScreenshot()` (this is the image that
    sits beneath the elements) and the thumbnail via `_tryThumbnail()`.
  - Thumbnail composition: when the slide has overlays, draw them over the fresh
    map thumbnail on a temporary offscreen `fabric.StaticCanvas` (reusing
    `overlayToFabric`) so the strip tile matches what the slide really shows;
    graceful fallback to the plain map thumbnail if fabric is unavailable.
- Toolbar: `📷 Capture into Slide` (`data-act="recapture"`) right after Add Slide,
  tooltip: "Re-shoot the map into the selected slide — the image goes beneath the
  slide's annotations. With no slide selected, adds a new one."
- Works on imported slides too — this is the flagship workflow: import a PPTX with
  text/shape elements, select a slide, frame the map, Capture into Slide → the live
  map now sits beneath the imported elements and the slide gains real map state.

## Harness sync (CLAUDE.md rule 5)

- `index.html` / `src/main.ts` API Test panel: add "Import PPTX" and
  "Capture into Slide" buttons to the existing briefing test section.

## Error handling

- Not a zip / missing `ppt/presentation.xml` → Engine Log error "Not a valid
  PowerPoint file", no slide changes.
- Per-slide parse failures are caught per element — one bad shape never kills the
  import; it lands in the warnings summary.
- All screenshot paths in O2 keep the existing timeout guards (3D-headless hang).

## Testing (manual GUI, per project practice)

1. **Round-trip**: capture 2–3 slides with annotations → Export PPTX (flat +
   editable) → Import PPTX → titles, notes, text/shape/freehand overlays and the
   raster background must reappear; re-export and open in PowerPoint.
2. **PowerPoint-authored deck**: title, multi-picture slide, table, speaker notes →
   verify title/notes mapping, composited pictures, flattened table text.
3. **Capture into Slide**: fresh capture on a slide with annotations (image beneath
   elements, thumbnail shows both); on an imported slide (gains map state); with no
   slides (creates one). Save/Load briefing JSON before/after — version 4 documents
   reload cleanly.
4. `npm run build` (vite) passes; `tsc` filtered to touched files only.
