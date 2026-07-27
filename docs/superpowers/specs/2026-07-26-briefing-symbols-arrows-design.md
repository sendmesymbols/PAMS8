# Briefing: MIL-STD symbols + tactical arrows — design

**Date:** 2026-07-26
**Scope:** `MS/Engines/Briefing/` slide editor, `MS/Engines/ImportExport/` PPTX round-trip

## Problem

The slide editor can draw PowerPoint-style shapes, text, tables and thin arrows, but it
cannot place a military symbol. Today the only way to get a 2525D symbol onto a briefing
slide is to capture it as part of the map background, which bakes it into the screenshot —
it cannot be moved, restyled or placed on a screen-only slide (an ORBAT page, a legend, a
task-organisation chart).

The library already owns everything needed: `milsymbol.js` renders any 2525D SIDC to a
canvas, and `MS/Data/Symbols.json` holds 511 `FPoint` entries already grouped and
searchable. This design surfaces that catalogue inside the slide editor.

Separately, the editor's `arrow` kind is a thin stroked line with terminators. Briefings
need the filled tactical arrow — the axis-of-advance / main-attack silhouette — and
PowerPoint-style block arrows, including two-headed variants.

## Requirements

1. Place any of the 511 `FPoint` symbols on a slide, browsable and searchable.
2. A placed symbol stays live: affiliation, status, echelon, size and text amplifiers are
   all editable after placement.
3. Filled tactical attack arrows (single- and two-headed) and block arrows.
4. **Everything must export.** Each new kind round-trips: on-canvas render → briefing
   save/load → `.pptx` export → `.pptx` re-import. Export fidelity is not an afterthought;
   a kind that cannot leave the app is not done.
5. No regression to existing overlays; old briefings load unchanged.

## Non-goals

- Placing symbols on the **map** from the briefing. `SymbolEngine` already owns that path;
  these overlays are screen-space slide annotations, like every other `SlideOverlay`.
- Geo-anchoring a slide symbol to a map location.
- `Point` / `Line` / `Area` catalogue symbols. `FPoint` only, per the request.
- Recovering a SIDC from an imported PPTX image (see Limitations).

## Background: how the pieces already fit

**milsymbol is one call.** `UEISymbol.ts:79` does
`new window.MS.symbol(sidc, opts).getMarker().asCanvas()`. Nothing about that is
map-specific — the same call serves a slide overlay.

**Symbols.json keys are SIDC fragments.** `SymbolEngine.ts:2936` looks up
`symbolData[symbolSet + entity]`, where `symbolSet = sidc.substring(4,6)` and
`entity = sidc.substring(10,16)`. So an 8-char key like `01110104` is positions 5–6 and
11–16 of a full 20-char SIDC. The remaining positions — context, affiliation, status,
HQ/TF/dummy, echelon, modifiers — are exactly what a picker supplies.

**`Grp` is a ready-made tree.** Every entry carries a 3-level path
(`["Air", "Fixed Wing", "Fighter"]`). Top-level FPoint distribution: Activities 149,
Land 139, Land Eqpt 94+3, Land Installation 79, Land Unit 7, Land Civilian Unit 5, Air 4,
Sea surface 3, Organization 2.

**`SymbolMetadataService`** already exposes `getData()`, `getByKey()` and
`getNamesForAutocomplete()` — the picker needs no new catalogue plumbing.

**The `image` overlay kind** already carries a picture through the whole pipeline:
preload, flip, opacity, PPTX emit. A milsym overlay is that pipeline with a generated
source instead of a stored one.

## Design

### 1. Data model

`OverlayKind` gains five members: `milsym`, `blockArrow`, `blockArrowDouble`, `chevron`
and `tacArrow`.

`BOX_OVERLAY_KINDS` gains `blockArrow`, `blockArrowDouble`, `chevron` — they are bbox +
rotation shapes and inherit that machinery wholesale.

New `SlideOverlay` fields, all optional:

| Field | Kinds | Meaning |
| --- | --- | --- |
| `sidc` | milsym | Full 20-char SIDC. **The single source of truth for what is drawn.** |
| `symKey` | milsym | Symbols.json key (`symbolSet+entity`). Display name + re-opening the picker on that entry. |
| `symOptions` | milsym | milsymbol text amplifiers — the 22 fields in `UEISymbol.AMPLIFIER_FIELDS`. |
| `width` | tacArrow | Body thickness, fraction of view height. |
| `headRatio` | tacArrow, block kinds | Head length. tacArrow: a fraction of the spine (default `0.15`). Block kinds: a multiple of the box **height**, which is the quantity OOXML's own arrow adjustment measures — default `0.5`, the preset's default. See §8 for why the units matter. |
| `taper` | tacArrow | Body narrows toward the tail. Default off. |

Reused as-is: `points` + `arrowType` (`sharp \| curved \| elbow`) + `arrowStart` /
`arrowEnd` for `tacArrow`; `fill`, `fillOpacity`, `stroke`, `strokeWidth`, `strokeDash`,
`opacity`, `rotation`, `flipX/Y`, `groupId`, `locked`, `labelOf` for everything.

**A milsym overlay stores no `src`.** Unlike `image`, there is no base64 payload — the
render regenerates from `sidc` + `symOptions` at whatever size is needed. Briefing files
stay small and symbols stay resolution-independent.

**Sizing.** `h` is authoritative (matching the `fontSize` / `strokeWidth` convention of
normalising to view height); `w` is recomputed from the rendered canvas aspect ratio. This
matters because amplifier text widens a marker asymmetrically — a symbol with a unique
designation is wider than the same symbol without one, and `w` must follow.

### 2. SIDC assembly — `buildSidc()`

Lives in `MilSymFactory.ts`. Assembles 20 characters from picker/style-bar state:

| Positions | Content | Source |
| --- | --- | --- |
| 1–2 | Version `10` | constant |
| 3 | Context | `0` (reality) |
| 4 | Standard identity | affiliation control |
| 5–6 | Symbol set | `symKey[0..2]` |
| 7 | Status | present / planned |
| 8 | HQ / task force / dummy | style bar |
| 9–10 | Echelon / mobility | style bar |
| 11–16 | Entity | `symKey[2..8]` |
| 17–20 | Modifiers | `0000` |

`parseSidcToState()` is its inverse, so the style bar can populate its controls from a
persisted overlay. These two functions are the entire bridge between the catalogue and
milsymbol.

### 3. Rendering — `MilSymFactory.ts` (new, ~120 lines)

```ts
renderMilSym(sidc: string, symOptions: Record<string, string>, pxHeight: number)
  : { canvas: HTMLCanvasElement; w: number; h: number } | null
```

- Calls `new window.MS.symbol(sidc, { size, ...symOptions }).getMarker()`, then `asCanvas()`.
- LRU-cached on `sidc | JSON(symOptions) | size-bucket`, reusing `MS/Cache/LRUCache.ts`.
  Size is bucketed so a resize drag does not thrash the cache.
- The fabric object is a `fabric.Image` built from the **canvas element directly** — no
  data-URL round-trip and no decode await, unlike the `image` kind. Selection, move,
  resize, rotate, flip, opacity, lock, grouping, eraser and laser therefore all work with
  no new code.
- `preloadOverlayImages` needs no milsym branch: rendering is synchronous.

**Graceful degradation.** `window.MS` is script-tag loaded, not an ES import. If it is
absent, the picker tool is hidden from the toolbar and existing milsym overlays render as
a labelled placeholder rectangle rather than throwing — matching how the engine already
treats an unusable overlay.

### 4. Picker — `MilSymPicker.ts` (new)

A flyout panel anchored to a new toolbar tool (`milsym`, shortcut `m`).

- **Header:** search input over `SymbolMetadataService.getNamesForAutocomplete()`, filtered
  to `SymGeoType === 'FPoint'`; plus an affiliation segmented control (Friend / Hostile /
  Neutral / Unknown) that live-recolours every visible thumbnail, so "hostile fighter" is
  one gesture.
- **Body:** collapsible tree built from the `Grp` field, or a flat ranked result list while
  searching.
- **Thumbnails:** rendered lazily through an `IntersectionObserver` at 32px, sharing the
  `MilSymFactory` LRU. The 149-entry Activities group renders nothing until scrolled into
  view.
- **Placement:** clicking a thumbnail arms the tool; the next canvas click places at a
  default height, or a drag sizes it.

### 5. Editing after placement

The style panel is driven by `SECTIONS_BY_CONTEXT` in `SlideEditorUI.ts`, keyed by
`PanelContext['kind']`. Three new contexts:

| Context | Sections |
| --- | --- |
| `milsym` | `['milsym', 'amplifiers', 'opacity']` |
| `blockarrow` | `['stroke', 'fill', 'fillop', 'width', 'dash', 'headratio', 'opacity']` |
| `tacarrow` | `['stroke', 'fill', 'fillop', 'width', 'dash', 'arrowtype', 'arrowheads', 'bodywidth', 'headratio', 'taper', 'opacity']` |

`milsym` is one new section row carrying the affiliation / status / echelon / HQ-TF-dummy
selects plus a Size (px height) input; `amplifiers` is a button opening a floating dialog
with the 23 text fields grouped (identity / movement / time), applied live. `headratio`,
`tacbody` (width + taper) are small numeric / toggle rows. Every other section is reused.

One slider serves both head sizes — its range and meaning follow the panel context, the
same routing the stroke-width control already does for the highlighter.

Any change rebuilds `sidc` or `symOptions`, re-renders through the factory, and swaps the
fabric image in place — preserving position, `h`, rotation, group membership and lock.

### 6. Block arrows

`blockArrow` (right), `blockArrowDouble` (left-right / two-head), `chevron`. Vertices are
generated by the existing `makeShapeObject` path that already serves diamond / triangle /
star / callout, parameterised by `headRatio`. Fill, stroke, dash, flip, rotate, group and
lock are inherited. The cheap tier — and they export as native, PowerPoint-editable arrows.

### 7. Tactical attack arrows — `TacArrowGeometry.ts` (new, ~150 lines)

`tacArrow` is a clicked spine that generates a filled outline:

- Spine capture reuses the `arrow` tool's interaction exactly (click to add points,
  double-click or Enter to finish) and its `sharp | curved | elbow` shape vocabulary.
- The outline offsets the spine by `±width/2`, optionally tapering toward the tail, and
  caps it with a triangular head sized by `headRatio`.
- `arrowStart` / `arrowEnd` decide which ends get heads — a head at both ends **is** the
  two-headed attack arrow.
- Rendered as a filled `fabric.Path`; fill, stroke, dash and opacity come from the standard
  style bar.

Pure functions over `{x, y}[]` in canvas pixels. No ArcGIS types.

**Accepted duplication.** `MS/Symbols/FreehandMainAttackArrow.ts` already implements this
math (`CreateArrowHeadPathEx`, bezier offsetting, head-ratio splicing), but it is bound to
ArcGIS `Point` / `Polygon`, `GeoTools` and a live view. Extracting a shared kernel would
mean touching a dozen map symbol classes to serve a briefing feature. We re-derive it in
screen space instead and accept the duplication. If the map arrows are ever refactored,
this is the natural second consumer.

### 8. Export and import

Export is a first-class requirement, not a trailing concern.

| Kind | PPTX emit | Result in PowerPoint |
| --- | --- | --- |
| `milsym` | Re-rendered at 4× on-slide pixel size, `addImage()` | Sharp raster; projector- and print-safe; renders identically in PowerPoint, Keynote and Google Slides |
| `blockArrow` / `blockArrowDouble` / `chevron` | Native `addShape()` via `OVERLAY_SHAPE_TYPES` → `rightArrow` / `leftRightArrow` / `chevron` at the default head size; `custGeom` with exact vertices otherwise | Native editable PowerPoint arrow, or an exact freeform |
| `tacArrow` | `custGeom` filled path — the route `PptxExporter.ts:1005` already uses for line / arrow / freehand | Editable freeform shape |

The 4× re-render is why milsym stores a SIDC rather than a baked PNG: export resolution is
decided at export time, not at insert time.

**Why block arrows have two emit paths.** The bundled pptxgenjs writes shape adjustment
values for exactly two cases (`rectRadius` and `angleRange`) — there is no API for an
arrow's head adjustment. A preset emitted with a custom head size would therefore render
at PowerPoint's default proportions instead of the drawn ones: a silent visual change.
So `headRatio` is defined in OOXML's own units (a multiple of the shape's height, default
`0.5`), which makes the default case byte-for-byte what the preset draws, and any other
value falls back to `custGeom` with our exact vertices. Default → a native arrow with
adjustment handles; customised → an exact freeform. Never a silent change.

**Import** (`PptxImporter.ts`): native `rightArrow` / `leftRightArrow` / `chevron`
`prstGeom` map back to the corresponding box kinds. `custGeom` continues to import as
`freehand`, as today.

### 9. Persistence and versioning

`BriefingDocument.version` → **6** ("milsym overlays + block and tactical arrows"). The
loader accepts 1–6. Unknown kinds already cause `buildOverlayObject` to return `null` and
be skipped, so a version-6 briefing opened by older code degrades by dropping the new
overlays rather than failing to load.

## Limitations

- An imported PPTX image that originated as a milsym comes back as a plain `image` overlay.
  The PNG carries no SIDC, and PPTX has no round-trip metadata channel we control.
- Milsym overlays require `window.MS`. Without it they render as placeholders.
- `tacArrow` geometry duplicates the map-side arrow math (see §7).

## Verification

Per new kind — `milsym`, `blockArrow`, `blockArrowDouble`, `chevron`, `tacArrow`:

1. Renders on the editor canvas; select / move / resize / rotate / flip / opacity / group /
   lock / eraser all behave.
2. Briefing save → reload restores it identically.
3. `.pptx` export opens in PowerPoint with the fidelity promised in §8.
4. `.pptx` re-import produces the mapped kind (or the documented fallback).
5. Present mode renders it, including through slide transitions.

Plus: a pre-existing briefing (version ≤ 5) loads unchanged; the picker opens and scrolls
smoothly with all 511 entries; the editor still loads with `window.MS` absent.

Build verification is `npm run build` (vite) — per project convention, raw `tsc` output is
swamped by pre-existing `@arcgis/core` resolution errors, so filter to touched files.

The pure layers are verifiable headlessly against the built `dist/` modules, with no DOM:
`TacArrowGeometry` (outline shape, both head configurations, taper, degenerate spines, the
short-and-thick clamp) and `MilSymFactory`'s SIDC assembly / parsing / amplifier cleaning,
plus `blockArrowPoints`. Everything above those — rendering, picker, editor, PPTX — needs
the browser.

## Files

**New (3)**
- `MS/Engines/Briefing/MilSymFactory.ts` — render + LRU + `buildSidc` / `parseSidcToState`
- `MS/Engines/Briefing/MilSymPicker.ts` — search + grouped grid flyout
- `MS/Engines/Briefing/TacArrowGeometry.ts` — filled arrow outline generation

**Modified (6)**
- `MS/Engines/Briefing/BriefingTypes.ts` — kinds, fields, version 6
- `MS/Engines/Briefing/OverlayFabric.ts` — build + read-back cases
- `MS/Engines/Briefing/SlideEditor.ts` — tools, placement interaction, style plumbing
- `MS/Engines/Briefing/SlideEditorUI.ts` — `TOOL_DEFS`, `ICONS`, `SECTIONS_BY_CONTEXT` + new section rows, amplifier sub-panel
- `MS/Engines/ImportExport/PptxExporter.ts` — three emit paths
- `MS/Engines/ImportExport/PptxImporter.ts` — `prstGeom` mapping for the block arrows

## Sequencing

The two halves are independent and can ship in either order:

- **A — symbols:** `MilSymFactory` → `BriefingTypes` → `OverlayFabric` → `MilSymPicker` →
  style bar → PPTX emit.
- **B — arrows:** block arrows first (they are nearly free), then `TacArrowGeometry` and
  `tacArrow`.
