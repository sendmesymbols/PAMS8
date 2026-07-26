# Briefing slide editor — Tables, Bullets & Numbering

**Date:** 2026-07-26
**Scope:** `MS/Engines/Briefing/`, `MS/Engines/ImportExport/`

Add three PowerPoint-like authoring features to the slide editor: a real table
object, and bullet / numbered lists on text boxes. All three persist in the
briefing document, render in present mode, and emit as **native** PowerPoint
objects on export. Tables and bullets also round-trip back in on PPTX import.

## Decisions

| Question | Decision |
| --- | --- |
| Table depth | Real `'table'` OverlayKind with a rows/cols model, not a spawned grid of shapes |
| List scope | Whole text box, one level (`listStyle`), not per-line indent outlines |
| Table styling | Table-wide border/fill/font + a header-row toggle |
| PPTX import | Yes — parse `graphicFrame > a:tbl` back into table overlays |
| List markers | Re-derived on `editing:exited`, not on `text:changed` |
| Table rotation | Not offered (see below) |
| Positional row/col ops | Out of scope — steppers only |

### Why markers are deferred to commit

The fabric `Textbox` holds the *marked* string so the user edits exactly what
renders. Re-deriving markers on every `text:changed` means shifting
`selectionStart`/`selectionEnd` by the per-line marker delta on each keystroke,
and any error there puts the caret in the wrong place on every Enter. Deferring
to `editing:exited` needs zero caret math: typing `• a⏎b` settles to
`• a⏎• b` on commit, with numbers renumbered. Marginally less live, materially
less fragile.

### Why tables do not rotate or flip

pptxgenjs `addTable` accepts no `rotate` option, so a rotated table would
silently export unrotated. The control is withheld rather than allowed to
create a mismatch the export can't honour.

## Model — `BriefingTypes.ts`

`OverlayKind` gains `'table'`. `SlideOverlay` gains five optional fields, so
every existing slide loads unchanged:

```ts
listStyle?: 'bullet' | 'number';   // text only
rows?: string[][];                 // table only; rectangular
colWidths?: number[];              // fractions of w, sum 1. Absent = equal
rowHeights?: number[];             // fractions of h, sum 1. Absent = equal
headerRow?: boolean;
headerFill?: string;
```

Tables **reuse** existing fields rather than duplicating them:
`fill`/`fillOpacity` = body cells, `stroke`/`strokeWidth`/`strokeDash` =
gridlines, `fontFamily`/`fontSize`/`bold`/`italic`/`align`/`textColor` = cell
text, plus `opacity`/`groupId`/`locked`. That reuse is what lets the existing
style bar drive a table with almost no new controls.

`BriefingDocument.version` → `1|2|3|4|5`. 5 = tables + list styles; 1–5
accepted on import.

## New module — `MS/Engines/Briefing/OverlayTable.ts`

`OverlayFabric.ts` is already ~870 lines and `SlideEditor.ts` ~3200, so the
table gets its own owner instead of swelling either.

| Export | Purpose |
| --- | --- |
| `normalizeTable(o)` | rectangularize rows; widths/heights as fractions summing to 1 |
| `buildTableGroup(o, W, H)` | fabric `Group`: grid `Rect`s + one `Textbox` per cell |
| `tableFromFabric(obj, W, H)` | read `data.table` + bbox back into the model |
| `cellRectAt(obj, x, y)` | hit-test → `{ r, c, left, top, width, height }` |
| `setCellText(obj, r, c, t)` | write one cell |
| `insertRow` / `deleteRow` / `insertCol` / `deleteCol` | mutate, then rebuild children in place |
| `rebuildTableChildren(obj)` | regenerate the group's children from `data.table` |

`OverlayFabric` only delegates: one `case 'table':` in `buildOverlayObject`,
one branch in `fabricToOverlay`.

## List markers — `OverlayFabric.ts`

Two helpers, ~15 lines each:

- `applyListMarkers(text, style)` — prefixes `'• '` or `'1. '`, `'2. '`, …
- `stripListMarkers(text, style)` — strips via `/^\s*(?:•\s+|\d+[.)]\s+)/`

`overlayToFabric` applies them when building the Textbox; `fabricToOverlay`
strips them so the persisted `text` stays clean. Toggling `listStyle` off
therefore restores the original text exactly.

## Editor — `SlideEditor.ts` / `SlideEditorUI.ts`

- **New tool** `table`, letter `g` ("grid"), after `image` in the palette.
  Drag to size, or click for a default 0.3 × 0.2 at 3 × 3.
- **Cell editing**: `_onDoubleClick` gains a `'table'` branch — `cellRectAt`
  → transient `Textbox` positioned over the cell → `enterEditing()` → write
  back on exit. Mirrors the existing `_editLabel` path. `Tab` / `Shift+Tab`
  commits and moves to the next / previous cell.
- **Style bar**: new `kind: 'table'` panel context reusing fill, stroke,
  width, dash, font, align, colour and opacity, plus a `Header row` toggle
  with its own fill swatch and four steppers — `+Row −Row +Col −Col`.
- **Text row**: two mutually-exclusive toggles, `•` and `1.`, applying to the
  selection and to the text tool's defaults.

## Export — `PptxExporter.ts`

Overlays already emit in **both** modes — `_emitOverlays` is called
unconditionally, outside the `mode === 'editable'` branch — so tables and
lists export in Mode A (flat), Mode B (editable), 2D and 3D alike.

- `_emitOverlayText`: with `listStyle` set, pass a run array instead of a
  string — `lines.map(t => ({ text: t, options: { bullet, breakLine: true } }))`
  with `bullet: true` or `{ type: 'number' }`. Non-list path untouched.
- `_emitOverlayTable`: new — `slide.addTable(cells, { x, y, w, h, colW, rowH,
  fontSize, fontFace, border, margin })`; header row takes `headerFill` + bold.
  `opacity` folds into per-cell fill and border `transparency`, since
  `addTable` has no object-level transparency.

Verified present in the bundled pptxgenjs 4.0.1 (`MS/ThirdParty/PptxGenJS/pptxgen.bundle.js`):
`addTable`, `buChar`, `buAutoNum`, `arabicPeriod`, `indentLevel`, `a:tbl`, `gridCol`.

## Import — `PptxImporter.ts`

Replace the `graphicFrame` skip with a table parser: `a:xfrm` → bbox,
`a:tblGrid/a:gridCol/@w` → `colWidths`, `a:tr/@h` → `rowHeights`,
`a:tc/a:txBody` → cell text via the existing run-text helper, style from the
first styled run (the convention already used for text boxes), `headerRow`
from `a:tblPr/@firstRow`.

Merged cells are not modelled: `gridSpan` / `vMerge` **flatten** —
continuation cells arrive empty and the existing warning counter reports it.

Text import also reads `a:buChar` / `a:buAutoNum` → `listStyle`, stripping any
literal marker character so it isn't doubled on render.

## Verification

`npx tsc` is a stub in this repo and the real `tsc` drowns in ~3000 unrelated
`TS2307` @arcgis resolution errors, so:

1. `node node_modules/typescript/bin/tsc -p tsconfig.build.json`, filtered to the touched files
2. `npm run build` (vite is what actually ships)
3. Manual GUI on the dev server: insert a table, edit cells, step rows/cols,
   toggle both list styles, save + reload the plan, export PPTX and open it,
   then re-import that same PPTX and confirm the table returns as a table.
