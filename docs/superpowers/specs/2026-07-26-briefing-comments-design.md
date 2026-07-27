# Briefing review comments — design

**Date:** 2026-07-26
**Status:** approved, not yet implemented
**Source of the idea:** the review-comment system in `bento/slides`
(`slides/src/editor/comments.ts`, `Comment` in `slides/src/model.ts`, the
`.ed-comment-*` CSS block in `slides/src/styles.css`), reachable in the shipped
demo's topbar.

## Goal

Reviewers can pin threaded comments to a briefing slide — to an annotation, to a
spot on the slide, or to the slide as a whole — reply, resolve and delete them.
Comments are saved with the briefing, shown only in the slide editor, and
exported as **native PowerPoint comments**.

## Non-goals

- Live collaboration. Bento's comments ride its CRDT; PAMS8 has no collab layer
  and this design adds none. Comments travel in the saved briefing file.
- Anchoring to map graphics (`graphic.attributes.id`). Considered and dropped:
  it needs per-slide screen projection of the graphic, and the three overlay/
  point/slide anchors cover the review use case.
- Rendering in present mode, in thumbnails, or in any rasterized export.

## What bento does, for reference

`Slide.comments[]` of `{id, elementId?, x?, y?, author, text, at, resolved?,
replies[]}`. One entry point — a topbar 💬 button (`C`) arms a one-shot click.
While armed, hovering previews the pending anchor: amber outline over an
element, a pin + coordinates on empty slide, the whole-slide outline out on the
grey surround. Elements covering ≥80% of the slide never capture, so a comment
"here" on scenery means the spot, not the backdrop. Numbered teardrop markers
live on a `.ed-comment-layer`; clicking one opens a popover with the entries, a
reply box, Resolve/Reopen and Delete. Author name in `localStorage`.
Unresolved threads badge the sidebar thumbnail. `window.bento.comments()`
returns a flat typed-anchor list for tooling.

## Deviations from bento, and why

| Bento | Here | Why |
| --- | --- | --- |
| Point anchors in slide pixels | Normalized `[0..1]` | The editor canvas resizes with the notes drawer, the side rails and the window (`_resizeStageToFit`), so pixel anchors would drift. Normalized is also the space `SlideOverlay` already uses and maps straight into the PPTX contain-fit rect. |
| Markers over a CSS-`scale()`d stage | Markers projected through fabric's `viewportTransform` | The editor canvas is fabric with its own zoom (ctrl+wheel) and pan (space / middle-drag). |
| `window.prompt` for name and text | In-editor composer styled with `ms-sledit-` tokens | A system dialog over a full-screen dark editor reads as a fault. |
| Comments are undoable (store-backed) | Comments are **outside** the undo stack | `_snapshotJson()` is the overlay array; widening it would make every reply a canvas-history step and force `_restore` to rebuild markers. Delete gets a confirm instead. |
| `C` arms comment mode | `N`, plus `Ctrl+Alt+M` | `c` is already the callout tool (`TOOL_DEFS`). `Ctrl+Alt+M` is PowerPoint's own New Comment shortcut. |
| No export of comments | Native PowerPoint comment parts | Requested; see §5. |

## 1. Data model — `BriefingTypes.ts`

```ts
/** One authored message: the thread opener, or a reply. */
export interface SlideCommentEntry {
  id: string;
  author: string;
  text: string;
  /** ISO datetime. */
  at: string;
}

/**
 * A review comment thread. Editor-only: never drawn in present mode, in
 * thumbnails or in any rasterized export — but saved with the slide so it
 * travels with the briefing, and emitted as a real PowerPoint comment by
 * PptxExporter.
 */
export interface SlideComment extends SlideCommentEntry {
  /**
   * The overlay this thread is pinned to (`SlideOverlay.id`). Absent = the
   * thread uses `x`/`y`, or the slide. Dangling ids are dropped on load, so
   * deleting an annotation turns its comments into slide-level ones rather
   * than orphaning them.
   */
  overlayId?: string;
  /** Normalized point anchor — same space as SlideOverlay. Used when no overlayId. */
  x?: number;
  y?: number;
  resolved?: boolean;
  replies?: SlideCommentEntry[];
}
```

Added to `Slide`:

```ts
  /** Review comment threads (editor-only; see SlideComment). */
  comments?: SlideComment[];
```

`BriefingDocument.version` → `7`, accepted range `1 | … | 7`, with the existing
doc-comment extended: *7 = review comments*. `exportBriefing()` /
`importBriefing()` need no change — both shallow-spread each slide, so a new
optional field rides along.

Present mode and thumbnails need no change either: `_buildOverlayCanvas` reads
only `slide.overlays`, and `_saveCurrent`'s `toDataURL` sees only fabric
objects. Comments are invisible there by construction.

## 2. `MS/Engines/Briefing/SlideComments.ts` — the editor-side feature

The pure parts — anchor projection, relative-time formatting, dropping dangling
anchors, id minting — live in a sibling `SlideCommentUtils.ts` that has **no
runtime imports at all** (only `import type`, which type-stripping erases).
That is what makes them runnable under bare `node`: this repo has no test
framework, and node's ESM resolver rejects the extensionless imports that Vite
accepts, so any module reachable by a test must not import one.

One exported class, `CommentsLayer`, holding everything: the marker layer, the
arm/hover/place flow, the composer, the thread popover, and the author name.
It is constructed with a host interface and never imports `SlideEditor`:

```ts
export interface CommentsHost {
  /** Read the open slide's threads. CommentsLayer never mutates this array. */
  comments(): readonly SlideComment[];
  /** Commit a new array; the editor stores it and refreshes its badges. */
  setComments(next: SlideComment[]): void;
  /** The fabric canvas, for viewportTransform and object lookup. Null while loading. */
  canvas(): any | null;
  /** Canvas size in px — the normalized↔canvas conversion basis (_W / _H). */
  size(): { w: number; h: number };
}
```

**Ownership is one-way.** `SlideEditor` owns a `_comments: SlideComment[]`
working array for the open slide — filled in `_loadSlide` from
`slide.comments`, collected by `_saveCurrent` into its patch, exactly how the
fabric canvas holds the working overlay state. `CommentsLayer` only ever reads
through `comments()` and writes whole arrays through `setComments()`, which is
also where the editor refreshes the rail and strip badges. No shared mutable
array, so there is one place a comment change can enter the save path.

Public surface:

- `mount(stageWrap: HTMLElement, canvasEl: HTMLCanvasElement)` — build the
  marker layer. Called from `_initCanvas` **after** the canvas is appended,
  next to the existing `ui.remountPanel()` call, because `_initCanvas` clears
  `stageWrap.innerHTML` on every slide load.
- `refresh()` — reposition every marker. Called on zoom, pan, resize, slide
  load and after each mutation.
- `arm()` / `disarm()` / `get armed()` — the one-shot placement mode.
- `unmount()` — drop the layer and any document-level listeners.
- `load()` — drop threads whose `overlayId` no longer resolves (they become
  slide-level), then `refresh()`.

### Coordinate transform

The layer is absolutely positioned over the canvas element inside
`.ms-sledit-stagewrap` (`overflow:hidden`, `pointer-events:none`; markers get
`pointer-events:auto`). A normalized anchor becomes a marker position via
fabric's viewport transform:

```
vpt   = fc.viewportTransform          // [zx, 0, 0, zy, tx, ty]
left  = nx * W * vpt[0] + vpt[4]
top   = ny * H * vpt[3] + vpt[5]
```

Overlay-anchored markers read the **live** fabric object's `getBoundingRect()`
top-right corner, so a marker follows an object being dragged; they fall back to
the stored normalized box when the object is missing. Slide-level threads stack
down the top-left, 26px apart, as in bento.

`refresh()` must be called from: `_zoomTo`, `_resetZoom`, `_beginPan`'s move
handler, `_resizeStageToFit`, the end of `_initCanvas`, and `object:modified` /
`object:moving` for overlay-anchored markers.

### Placement flow

`arm()` sets a crosshair cursor over the whole canvas area and installs
capture-phase `mousedown` / `mousemove` / `keydown` listeners on `document` —
capture propagates top-down, so these fire before fabric's own
`wrapperEl` capture listener and before `_onPreMouseDown`, exactly as bento
beats Selecto/Moveable.

`anchorAt(clientX, clientY)` mirrors bento's `commentAnchorAt`: map to
normalized coords; return `null` when outside the canvas (→ whole-slide
anchor); otherwise find the topmost visible fabric object containing the point,
**skipping objects whose area is ≥80% of the canvas** (backdrop rule).

Hover preview, matching bento's three states:

- over an object → amber dashed outline on its bounding rect
- over bare slide → pin dot + `x, y` readout in normalized-to-px coords
- outside the canvas → whole-slide dashed outline plus a cursor-following
  "💬 whole slide" chip

Click places and disarms. `Esc`, re-toggling, or clicking other chrome disarms
without placing.

Comment mode and drawing tools are mutually exclusive, and **`SlideEditor` owns
that rule** — `CommentsLayer` has no view of the tool state. The editor's
`_toggleCommentMode()` calls `_setTool('select')` before `layer.arm()`, and
`_setTool` calls `layer.disarm()`. Comment mode is **not** a `Tool` and does not
enter `TOOL_DEFS`, so the `_setTool('select')` that every slide load performs
cannot leave it armed.

### Composer and thread popover

Both are `ms-sledit-`styled panels, not `window.prompt`.

- **Composer** — opens at the placement point: a textarea, an author-name field
  shown only when no name is stored yet, Comment / Cancel. Enter+Ctrl commits.
- **Thread popover** — opens from a marker: header naming the anchor
  (`Comment · annotation` / `Comment · point (x, y)` / `Comment · slide`), the
  entries with author and relative time (`just now`, `5m ago`, `3h ago`,
  `2d ago`, else a locale date), a reply textarea, and Reply / Resolve-Reopen /
  Delete. Delete confirms, because comments are outside undo. Dismissed by a
  capture-phase `pointerdown` outside it, as in bento.

Fresh markers pulse once (bento's `fresh` class + keyframes).

Author name lives in `localStorage['ms-briefing-author']`; the thread header
carries a `you: <name> ✎` control to change it, and existing threads keep their
original author.

### Escape ladder

`_attachKeys`'s Escape ladder gains a rung for "comment mode is armed → disarm"
placed **before** the `_tool !== 'select'` rung, so Escape never closes the
editor while comment mode is up.

## 3. Chrome — `SlideEditorUI.ts`

- A 💬 button in the topbar's right-hand group, beside the notes button, with
  `data-act="comment"` and an `ms-sledit-armed`-style active state driven by an
  `onCommentModeChange`-equivalent callback (mirroring the existing `toolLock`
  button's pattern).
- A `comment` icon in `ICONS`.
- A `.ms-sledit-cmt*` CSS block ported from `.ed-comment-*`, retinted to the
  editor's dark palette and its `--sl-*` tokens: marker (19px teardrop,
  `border-radius: 50% 50% 50% 3px`), `resolved` at 35% opacity, hover scale,
  the pop panel, the hover highlight in its element / pin / slide variants, and
  the cursor chip.
- **Rail thumb badge**: `refreshRail()` renders an unresolved-count dot when a
  slide has open threads. `RailHost.slides()` widens to
  `{ title, thumb?, openComments?: number }`.
- **Review list section**: a new `ms-sledit-sec` in `ms-sledit-slidesecs`
  (slide-level, so always visible), titled "Comments", listing this slide's
  threads — author, first line, reply count, resolved state — with a
  "show all slides" toggle. Clicking an entry on the current slide opens its
  thread. An entry on another slide navigates there via the existing
  `RailHost.go` — which saves and reloads asynchronously — so the thread is
  opened from a "pending thread to open" id the layer consumes at the end of
  `load()`, not immediately after the `go()` call. Uses the existing
  section-collapse persistence, default collapsed.

Help overlay gains the `N` / `Ctrl+Alt+M` line.

## 4. Wiring — `SlideEditor.ts` and `BriefingEngine.ts`

`SlideEditor.ts`:

- Own a `CommentsLayer`, constructed in `_buildStage`, `mount`ed in
  `_initCanvas`, `unmount`ed in `close`.
- `_loadSlide` calls `load()` after the canvas is built.
- `_saveCurrent` adds `comments` to the patch it hands `host.onSaved`.
- `SlideEditorHost.onSaved`'s patch type widens with
  `comments?: SlideComment[]`.
- `_onAction` handles `'comment'`; `_attachKeys` handles `N` and `Ctrl+Alt+M`.

`BriefingEngine.ts`:

- `onSaved` persists `s.comments = patch.comments`.
- `_editorHost().listSlides()` reports `openComments` per slide.
- `_refreshStrip` badges slides with open threads, matching the rail badge.
- New public `listComments()` — the flat typed-anchor list, PAMS8's equivalent
  of `window.bento.comments()`:

```ts
public listComments(): Array<{
  slideIndex: number;
  slideId: string;
  id: string;
  anchor:
    | { type: 'overlay'; overlayId: string }
    | { type: 'point'; x: number; y: number }
    | { type: 'slide' };
  author: string;
  at: string;
  text: string;
  resolved: boolean;
  replies: SlideCommentEntry[];
}>
```

## 5. Native PowerPoint comments

### Format choice: legacy comment parts

Legacy PresentationML comments (`p:cmLst` + `commentAuthors.xml`) are chosen
over modern threaded comments (`p188`, `ppt/comments/modernComment_*.xml`).
Legacy is fully specified in ISO/IEC 29500, read by every PowerPoint version as
well as LibreOffice and Google Slides, and needs four small parts. Modern
comments carry native threads but are a Microsoft extension with GUID-named
parts and thin public documentation — materially more risk for one gained
feature. PowerPoint 365 reads legacy comments and offers to upgrade them.

### The units trap

ISO/IEC 29500 declares `p:pos`'s `x`/`y` as `ST_Coordinate` (EMU), but
Microsoft's implementer notes ([MS-OI29500 §19.4.5](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/34ada90e-9cb8-4efb-b20e-027eed8c75e3),
note b) state that **PowerPoint treats them as `ST_EighthPointMeasure`** — 1/8
point, i.e. 1/576 inch. Writing EMUs would put every marker at the slide's
top-left corner.

So `eighthPt = Math.round(inches * 576)`. The exporter's layout is pptxgenjs
`LAYOUT_16x9` = `SLIDE_W_IN` 10 × `SLIDE_H_IN` 5.625 in, so the slide spans
5760 × 3240 units.

Anchor → position, using the exporter's existing `ContainFit`:

| Anchor | inches |
| --- | --- |
| overlay | `fit.x + (o.x + o.w) * fit.w`, `fit.y + o.y * fit.h` (box top-right) |
| point | `fit.x + c.x * fit.w`, `fit.y + c.y * fit.h` |
| slide | `fit.x + 0.02 * fit.w`, `fit.y + (0.02 + n * 0.05) * fit.h` (stacked) |

### `MS/Engines/ImportExport/PptxComments.ts`

No briefing-type dependency, so it is testable standalone. The XML and
string work is **pure and separately exported** from the zip plumbing, so the
risky parts (eighth-point math, escaping, author/`idx` allocation, relationship
id allocation) can be unit-tested in node while only the thin JSZip glue relies
on a browser:

```ts
export interface PptxCommentRecord {
  /** 1-based pptx slide number this comment belongs to. */
  slide: number;
  author: string;
  /** ISO datetime. */
  at: string;
  text: string;
  /** Eighth-points from the slide's top-left. */
  x: number;
  y: number;
}

export interface PptxCommentParts {
  /** ppt/commentAuthors.xml */
  authorsXml: string;
  /** One per commented slide, in ascending slide order. */
  slideParts: Array<{ slide: number; path: string; xml: string }>;
}

/** Pure: records → the XML of every part that must be added. */
export function buildCommentParts(records: readonly PptxCommentRecord[]): PptxCommentParts;

/** Pure: append a Relationship, allocating an id that can't collide. */
export function addRelationship(relsXml: string, type: string, target: string): string;

/** Pure: append <Override> entries before </Types>. */
export function addContentTypeOverrides(
  ctXml: string,
  overrides: ReadonlyArray<{ partName: string; contentType: string }>,
): string;

/** Glue: inject the parts into a pptxgenjs-generated package. */
export async function injectPptxComments(
  pkg: ArrayBuffer,
  records: readonly PptxCommentRecord[],
): Promise<Blob>;
```

`injectPptxComments` reads `window.JSZip` **inside the function body** (the
bundle's first UMD segment — the same global `PptxImporter` already relies on),
never at module scope, so the module stays importable in node. It writes:

**`ppt/commentAuthors.xml`** — one entry per distinct author name, `id` from 1,
`initials` from the name's word initials, `clrIdx = id - 1`, `lastIdx` = that
author's highest `idx`:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cmAuthor id="1" name="Abdul" initials="A" lastIdx="3" clrIdx="0"/>
</p:cmAuthorLst>
```

**`ppt/comments/comment{n}.xml`**, one part per slide that has comments (`n` is
a running 1-based counter over commented slides, not the slide number):

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:cmLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cm authorId="1" dt="2026-07-26T10:00:00.000" idx="1">
    <p:pos x="2472" y="1160"/>
    <p:text>Fix this boundary label</p:text>
  </p:cm>
</p:cmLst>
```

`idx` is unique per author across the document, starting at 1. `dt` is the
entry's own ISO `at`, normalized to millisecond precision and without a
timezone suffix (`2026-07-26T10:00:00.000`), which is the shape PowerPoint
writes.

**Relationships.** In `ppt/_rels/presentation.xml.rels`:

```xml
<Relationship Id="rId{next}"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors"
  Target="commentAuthors.xml"/>
```

In `ppt/slides/_rels/slide{N}.xml.rels`, for each commented slide:

```xml
<Relationship Id="rId{next}"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
  Target="../comments/comment{n}.xml"/>
```

`rId{next}` is `max(existing Id="rIdK") + 1` in that specific rels part — never
a fixed number, or it would collide with pptxgenjs's own ids.

**`[Content_Types].xml`** gains two overrides before `</Types>`:

```xml
<Override PartName="/ppt/commentAuthors.xml"
  ContentType="application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"/>
<Override PartName="/ppt/comments/comment1.xml"
  ContentType="application/vnd.openxmlformats-officedocument.presentationml.comments+xml"/>
```

(one `comments` override per part).

All text goes through the exporter's existing XML escaping for `& < > "`.

### Replies and resolved threads

Legacy `p:cmLst` has no thread element and no resolved flag.

- **Replies** are emitted as sibling `p:cm` entries at the **same** `p:pos`,
  each with its own author and its own later `dt`. PowerPoint groups co-located
  comments into one thread when it upgrades a deck to modern comments.
- **Resolved threads are skipped.** A resolved comment is closed business; the
  exporter logs how many it dropped.

### `PptxExporter.ts` changes

- Replace `await pptx.writeFile({ fileName })` with
  `const buf = await pptx.write({ outputType: 'arraybuffer' })`, then a blob
  download of either `await injectPptxComments(buf, records)` (when there are
  records) or `new Blob([buf], { type: PPTX_MIME })` (when there are none, so a
  comment-free export never touches JSZip). `write({ outputType })` is
  supported — the bundle forwards it to JSZip's `generateAsync({ type })`.
  Since the download becomes ours rather than pptxgenjs's, it needs the usual
  object-URL anchor click plus a `revokeObjectURL` afterwards.
- Build the pptx-slide↔briefing-slide map during the existing emit loop.
  `explodeBuilds` emits several pptx slides per briefing slide, so comments
  attach only to the **first** pptx slide generated from each briefing slide —
  otherwise a build sequence would repeat every comment.
- Log the emitted and skipped counts, as the exporter already does for shapes.

## 6. Sequencing

Two phases, each independently verifiable:

1. **Editor-side comments** (§1–4). Verified in the GUI: place all three anchor
   kinds, reply, resolve, delete, zoom/pan/resize the canvas and confirm
   markers track, navigate slides, save & reopen the briefing, confirm nothing
   appears in present mode or thumbnails.
2. **Native PPTX comments** (§5). Verified by exporting a deck and opening it in
   PowerPoint: comments present, attributed, threaded, and positioned where the
   markers were. The eighth-point conversion is the specific thing that
   verification is checking.

## Verification notes

- `npx tsc` in this repo is a no-op stub; use
  `node node_modules/typescript/bin/tsc`, and expect the ~3000 pre-existing
  TS2307 `@arcgis` resolution errors — filter output to the touched files.
- Real verification is `npm run build` (vite) plus manual GUI testing. The user
  runs the dev server themselves.

## Risks

| Risk | Mitigation |
| --- | --- |
| `p:pos` units wrong → all markers at the slide corner | Pinned to eighth-points via MS-OI29500; phase 2's PowerPoint open-and-check is exactly this test. |
| Rel-id collision with pptxgenjs | Compute `max + 1` per rels part rather than assuming a number. |
| Marker drift under zoom/pan | Single `refresh()` driven from every transform site; enumerated in §2. |
| Comment-mode click swallowed by fabric | Document-level capture listeners, which fire before fabric's `wrapperEl` capture handler. |
| Comments lost on slide navigation | `_saveCurrent` (which `_navigate` and the rail already call before every slide change) carries `comments` in its patch. |
