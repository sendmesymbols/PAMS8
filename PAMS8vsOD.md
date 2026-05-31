# PAMS8 vs ODINv2 — Symbology Learnings

ODINv2 repo: `D:\Projects\PAMS8\OD\` — https://github.com/syncpoint/ODINv2  
Map library: OpenLayers (not ArcGIS). Symbol standard: MIL-STD-2525D.

---

## What Can Be Learned / Adapted

### 1. `@syncpoint/signs` — Alternative Symbol Renderer

ODINv2 uses `@syncpoint/signs` instead of `milsymbol.js` for SVG generation.

- Entry point: `src/renderer/symbology/symbol.js`
- Usage: `symbol.asSVG()` → data URL → OL `Icon` style
- **ArcGIS adaptation**: Feed the SVG data URL directly into `PictureMarkerSymbol` — it accepts `data:image/svg+xml;utf8,...` natively. Directly portable, zero rework.
- Could be offered as an alternative renderer for UEI/force point symbols alongside the existing `milsymbol.js` path.

---

### 2. Control Point Constraint Hooks — Their Best Idea

File: `src/renderer/ol/interaction/modify/hooks-*.js`

Standard vertex editing (OL Modify / ArcGIS SketchViewModel) moves raw coordinates. ODINv2 intercepts vertex drags through **geometry-aware hooks** that enforce symbol-type constraints:

| Hook file | Symbol type | What it enforces |
|---|---|---|
| `hooks-rectangle.js` | Rectangles | Normal drag = scale via `AffineTransformation`; CMD+drag = rotate around center |
| `hooks-corridor.js` | Corridors | Offset point stays perpendicular to centerline; width = perpendicular distance |
| `hooks-fan.js` | Fans / arcs | Radial arms preserve angle when center moves; dragging arm adjusts radius |
| `hooks-collection.js` | GeometryCollections | Routes to correct sub-geometry handler by index |

**Core pattern** (`modify/writers.js`, `updateVertex()` lines 163–197):
```js
// Before committing a drag, run the hook
const projected = hook.project(newCoord, vertexIndex, geometry)
geometry.setCoordinate(vertexIndex, projected)
```

**PAMS8 application**: Your `EditEngine` delegates entirely to `SketchViewModel`, which has no knowledge of symbol types. Adding a hook layer on top of `SketchViewModel`'s `update` event would enable rectangle-aware resize/rotate, corridor width enforcement, and fan geometry editing — all currently missing.

---

### 3. JTS/JSTS Geometry Library — Directly Portable

Files: `src/renderer/ol/ts/library.js`, `src/renderer/ol/ts/parser.js`

**Zero OpenLayers dependency** — the `library.js` wrapper is pure JSTS calls. Only `parser.js` touches OL geometry types; replace that with an ArcGIS ↔ JSTS converter and the whole library drops in.

Available operations (beyond current `GeoTools.ts`):

| Function | Use in PAMS8 |
|---|---|
| `AffineTransformation.scaleInstance()` | Rectangle resize |
| `AffineTransformation.rotationInstance()` | Rectangle / symbol rotate |
| `singleSidedLineBuffer()` | One-sided corridor offsets |
| `minimumRectangle()` | Bounding box for selection handles |
| `projectCoordinate(origin, bearing, distance)` | Control point projection |
| `projectCoordinates()` | Batch projection (fan arms, rings) |
| `centroid()`, `union()`, `intersection()`, `difference()` | Analysis engine geometry ops |

**Migration path**: Write `src/MS/Support/JTSBridge.ts` that converts ArcGIS `Point`/`Polyline`/`Polygon` to JSTS geometries and back, then import `library.js` unchanged.

---

### 4. Symbol Descriptor System — Enriching `Symbols.json`

File: `src/renderer/symbology/2525c.js`

ODINv2 maintains per-SIDC metadata that drives both rendering and editing:

```js
{
  geometry: 'Polygon',
  layout: 'corridor',      // rectangle | fan | circle | corridor | orbit
  maxPoints: 2,
  minPoints: 2,
  dimensions: { am: true } // which amplifiers control geometry dimensions
}
```

The `layout` field is what activates the correct constraint hook at edit time.

**PAMS8 application**: `Symbols.json` already has `SymGeoType` and `Parameters` — adding a `Layout` field (e.g., `"rectangle"`, `"corridor"`, `"fan"`) per entry is the prerequisite for implementing constraint hooks. The descriptor then becomes the dispatch key:

```ts
// In EditEngine, on SketchViewModel update:
const hook = getHookForLayout(graphic.attributes.layout)
if (hook) hook.project(newGeometry, vertexIndex)
```

---

### 5. Specialized Tactical Graphic Renderers

Files: `src/renderer/ol/style/polygon-styles/`, `src/renderer/ol/style/corridor-styles/`

40+ per-symbol style functions that compute geometry **at render time** based on map resolution. Notable techniques:

**Canvas pattern fills** (`ol/style/patterns.js`, lines 56–90):
- Hatch / cross fills with arbitrary rotation angle
- Proper device-pixel-ratio scaling
- **PAMS8**: ArcGIS supports `CIMSymbol` with hatch fills but this canvas approach gives finer control for custom fills inside area symbols.

**Dynamic corridor double-line** (e.g., `corridor-styles/G_T_B.js`):
- Takes a centerline + width, projects perpendicular offset to both sides
- Renders as `MultiLineString` (two parallel lines)
- Adds rotated text label aligned to corridor bearing, with upside-down correction
- **PAMS8**: Several area symbols (e.g., routes, passages) currently render as plain styled polygons — this pattern shows how to make them look spec-correct.

**Hatch fill via projected segments** (e.g., `polygon-styles/G_M_OGR.js`):
- Breaks the polygon boundary into segments
- Projects offset points inward at fixed intervals
- Resolution-aware spacing (looks correct at all zoom levels)

---

### 6. Clone / Copy via CMD+Shift Drag

File: `src/renderer/ol/interaction/clone-interaction.js`

Clean in-place copy pattern:
1. On `CMD+SHIFT+pointerdown`: clone the feature, assign new UUID, add to layer
2. During drag: move the clone, leave original in place
3. On `pointerup`: commit clone, restore original position

Cleaner than the current PAMS8 copy → paste-mode flow for quick duplicate-and-place operations. Worth implementing as an optional shortcut in `SelectionEngine`.

---

### 7. State Machine for Editing Modes

File: `src/renderer/ol/interaction/modify/states.js`

Three clean states: `selected → drag → selected` with distinct event handlers per state. Each state only handles the events relevant to it — no flag soup.

```
selected:  pointerdown on vertex → drag
           pointerdown on segment → insert
           dblclick on vertex → remove
drag:      pointerdrag → updateVertex (with hook)
           pointerup → commit → selected
```

**PAMS8 application**: `EditEngine` currently manages edit state with boolean flags (`isModifyingSymbol`, `isEditingControlPoints`). A state machine would make adding new editing modes (constraint drag, clone drag) much cleaner.

---

## What Is Not Worth Porting

| ODINv2 thing | Reason to skip |
|---|---|
| Signal/reactive architecture (`@syncpoint/signal`) | ArcGIS `reactiveUtils` already handles reactivity |
| OL Translate / Modify interactions | ArcGIS `SketchViewModel` covers basic move/reshape |
| RBush spatial indexing for hit detection | ArcGIS `MapView.hitTest()` handles this |
| VectorSource / VectorLayer abstraction | `GraphicsLayer` + `GraphicsLayerManager` is the equivalent |
| Store / command pattern for undo | `UndoEngine` already exists in PAMS8 |
| Feature query / filter system | ArcGIS `FeatureLayer` query handles this |

---

## Recommended Implementation Order

| Priority | Task | File(s) to create/modify |
|---|---|---|
| 1 | Add `Layout` field to `Symbols.json` entries | `MS/Data/Symbols.json` |
| 2 | Write ArcGIS ↔ JSTS geometry bridge | `MS/Support/JTSBridge.ts` |
| 3 | Copy `OD/src/renderer/ol/ts/library.js` → `MS/Support/JTSLibrary.js` | new file |
| 4 | Implement `hooks-rectangle.ts` using JTS `AffineTransformation` | `MS/Engines/EditHooks/` |
| 5 | Implement `hooks-corridor.ts` (perpendicular constraint) | `MS/Engines/EditHooks/` |
| 6 | Wire hooks into `EditEngine` via `SketchViewModel` `update` event | `MS/Engines/EditEngine.ts` |
| 7 | Evaluate `@syncpoint/signs` as UEI symbol renderer | `MS/Symbols/UEISymbol.ts` |
| 8 | Port canvas hatch-fill pattern to area symbol renderers | `MS/Symbols/` |
