# Slide Editor — Multi-Point / Curved / Elbow Arrows (Design)

Date: 2026-07-25 · Status: approved (design confirmed in chat) · Scope: `MS/Engines/Briefing`

## Goal

Extend the SlideEditor's Arrow tool (currently a single 2-point drag with one fixed
triangle head) to support multi-point arrows with three render styles — Sharp,
Curved, Elbow — selectable per-arrow in the properties panel, matching the arrow
model on excalidraw.com but scoped down for a screenshot annotator rather than a
live shape graph (no shape-binding, no obstacle-avoiding routing).

## Data model (`BriefingTypes.ts`)

- `SlideOverlay.points` (already `Array<{x, y}>`) now holds **2 or more** entries for
  `kind: 'arrow'`, not always exactly 2. No schema break.
- New optional field: `arrowType?: 'sharp' | 'curved' | 'elbow'`. Absent = `'sharp'`,
  so every arrow in an existing saved briefing keeps rendering exactly as it does
  today — no migration.

## Drawing interaction (`SlideEditor.ts`)

The Arrow tool switches from single-drag to **click-chain placement**. The Line
tool is untouched (stays a plain 2-point drag).

- Click 1 places the start point. Each subsequent click adds a bend point. A
  rubber-band preview segment follows the cursor from the last placed point to
  the pointer.
- **Double-click** (or **Enter**) finalizes at the last point and commits the
  arrow (undo snapshot, select it). Finishing with fewer than 2 points is
  degenerate and discarded (same guard already used for drag-tools).
- **Escape** cancels the whole in-progress arrow and returns to Select —
  consistent with Escape's existing "back out" meaning elsewhere in the editor.
- The arrow is built using whichever type (Sharp/Curved/Elbow) is active in the
  style panel at the moment the drawing finishes.
- Double-clicking an **existing** arrow while the Arrow tool is active re-enters
  click-chain placement, appending further points to it (the main way to extend
  an Elbow arrow, since elbow segments don't get bow handles — see below).

## Rendering per type (`OverlayFabric.ts`)

`makeArrowGroup` generalizes from `(p0, p1)` to `(points[], stroke, strokeWidthPx,
extra, strokeDash, arrowType)`, building a `fabric.Path` "d" string instead of a
`fabric.Line`:

| Type | Path construction |
|---|---|
| Sharp | Straight segments: `M x0 y0 L x1 y1 L x2 y2 ...` (today's look, generalized to N points). |
| Curved | Smooth curve through all points via Catmull-Rom → cubic-bezier conversion, emitted as `M ... C ... C ...`. |
| Elbow | Segments forced horizontal-then-vertical between each consecutive pair of points, with a small rounded corner fillet (`Q` curve) at each turn. **No obstacle-avoidance** — a fixed-shape orthogonal connector, not a router. With only 2 points and no manual bends, defaults to a simple L-shaped dogleg (horizontal from start to the end's x, then vertical into the end point). |

- The arrowhead triangle angles off the tangent of the final segment (straight
  direction for sharp/elbow; the bezier's end-tangent for curved).
- `data.localPoints` generalizes from a fixed pair to an N-length array (still
  group-center-relative, recovered through the transform matrix exactly as
  today). `data.arrowType` is stored the same way `data.strokeDash` already is.
- `fabricToOverlay` / `overlayToFabric` round-trip `arrowType`, writing it to the
  persisted overlay only when it isn't `'sharp'` (keeps saved JSON minimal and
  matches how `strokeDash`/`opacity` are conditionally written elsewhere in this
  file).

## Editing after creation — the per-segment bow handle

Once an arrow is selected, each straight segment between two consecutive points
shows a small draggable handle at its midpoint, implemented via fabric's custom
`Control` API (positioned by transforming the segment midpoint through the
object's matrix). Dragging it **inserts a new point** at that location and
rebuilds the path in place, reusing the same builder function used at creation
time, fed the updated point list, with the rebuilt children swapped into the
existing group without disturbing its position/rotation/id.

This is the "bow" motion for **Sharp** and **Curved** arrows. **Elbow segments do
not get bow handles** (matching Excalidraw — an elbow's shape comes from its
waypoints, not freeform bending); to extend an elbow arrow, double-click it with
the Arrow tool active to append more waypoints (see Drawing interaction above).

This per-segment handle is the single largest chunk of new code in this feature
— custom fabric `Control`s aren't used anywhere else in this file yet.

## Properties panel (`SlideEditorUI.ts`)

- New `PanelContext.kind = 'arrow'`, split out from the current catch-all
  `'linework'` (which remains for the plain Line/Freehand tools).
- New panel section: a 3-button row (Sharp / Curved / Elbow icons) alongside the
  existing stroke/width/dash/opacity controls, following the same visual pattern
  as the existing dash-style buttons.
- `StyleDefaults` gains `arrowType`, defaulting to `'sharp'` and persisting across
  arrows drawn in the session, the same way stroke color/width/dash do today.

## Out of scope

- Shape-to-shape binding (an arrow anchoring to and re-routing with another
  overlay object as it's moved/resized) — not requested; would need new
  cross-object id plumbing and move-listener wiring disproportionate to this
  editor's screenshot-annotation use case.
- Full A*/grid obstacle-avoiding elbow routing (Excalidraw's actual elbow
  algorithm) — explicitly descoped in favor of a fixed-shape orthogonal
  connector; there's no live shape graph here for a router to avoid.
- Independent start-arrowhead / arrowhead style picker (triangle/circle/
  diamond/bar/etc.) — not part of this round; the arrow keeps its existing
  single triangle end-head.
- Deleting an individual point from a placed arrow (only adding via bow-handle
  drag, or via re-entering click-chain, is in scope).

## Verification

Pure interactive-canvas UI change — verified manually once implemented: draw a
Sharp/Curved/Elbow arrow with several bends each, drag a bow handle, switch an
existing arrow's type, save/reload the slide, reopen in Present mode. The user
runs `npm run dev` themselves; `tsc` is run scoped to the touched files
(`SlideEditor.ts`, `OverlayFabric.ts`, `SlideEditorUI.ts`, `BriefingTypes.ts`)
given the pre-existing build baseline noise.

## Files touched

- `BriefingTypes.ts` — `arrowType` field.
- `OverlayFabric.ts` — generalized `makeArrowGroup`, path-per-type construction,
  N-point `localPoints`, `arrowType` round-trip.
- `SlideEditor.ts` — click-chain drawing state machine for the Arrow tool,
  double-click-to-append editing, per-segment bow-handle controls.
- `SlideEditorUI.ts` — `arrow` panel context/section, `arrowType` style default
  and UI row.
