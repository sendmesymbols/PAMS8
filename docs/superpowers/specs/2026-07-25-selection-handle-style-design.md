# Slide Editor — Selection Handle Styling (Design)

Date: 2026-07-25 · Status: implemented · Scope: `MS/Engines/Briefing`

## Goal

Restyle fabric.js's default move/resize/rotate handles (unstyled stock
squares, confirmed via user screenshot) to match the Excalidraw look already
used for this editor's toolbar and properties panel — visual only, no
behavior change.

## Design

One-time global style on `fabric.Object.prototype`, applied once from
`SlideEditor._initCanvas`, so every shape kind (box shapes, text, line, arrow
groups) picks it up automatically with no per-object code:

- `cornerStyle: 'circle'`, `cornerColor: '#ffffff'`, `cornerStrokeColor:
  '#2d6cdf'`, `transparentCorners: false`, `cornerSize: 8` — solid white
  circles with a blue border at all 8 edge/corner handles and the rotate
  handle alike, replacing the previous hollow default squares.
- `borderColor: '#2d6cdf'`, `borderScaleFactor: 1.5`, `padding: 4` — blue
  selection outline, slightly bolder, small gap from the shape.
- `rotatingPointOffset: 24` — rotate handle sits closer above the shape than
  fabric's default 40px.

`#2d6cdf` reuses the single accent color already used everywhere in this
editor's reworked chrome (active tool/panel buttons, swatch selection
outline, arrow bow-handle) — no new color introduced.

This is a prototype-level (global) change, and `#fabricCanvas` elsewhere in
`index.html` is another potential `fabric.Canvas` consumer, so
`styleSelectionControls()` is paired with a `restoreSelectionControls()`
counterpart (saves the prior prototype values, restores them) called when
the Briefing editor closes.

## Explicitly out of scope

- The arrow tool's existing bow-handle (insert-a-bend control) keeps its
  current blue-filled/white-border coloring — left as a deliberately distinct
  affordance from the plain resize handles above.
- No change to which controls are visible per shape kind (e.g. Line's
  endpoint-only controls, Textbox's side-only controls) — fabric's existing
  per-type visibility is untouched; only appearance changed.

## Files touched

- `OverlayFabric.ts` — new `styleSelectionControls()` / `restoreSelectionControls()` exports.
- `SlideEditor.ts` — imports both; calls `styleSelectionControls()` at the top
  of `_initCanvas`, `restoreSelectionControls()` on close.

## Verification

`node node_modules/typescript/bin/tsc --noEmit` on both touched files: clean
(only pre-existing baseline errors, unrelated). Visual check is manual by the
user on their own `npm run dev` — click any shape, confirm filled circular
handles in blue, tighter to the shape than fabric's previous defaults.
