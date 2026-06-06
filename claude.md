# PAMS8 - Military Standard 2525D Symbol Drawing Library

## Project Overview

PAMS8 is a TypeScript library for drawing **MIL-STD-2525D** tactical symbols on maps,
built on the **ArcGIS Maps SDK for JavaScript** (the `@arcgis/core` ES-module package).
It draws unit/equipment & installation symbols, tactical point/line/area/freehand
graphics, and layers a large suite of analysis, measurement, decluttering, and editing
engines on top. It runs in both **2D (MapView)** and **3D (SceneView)**.

## Status (as of June 2026)

- **Active development** on `master`. Last tagged checkpoint: `6971f1c "Before Huge changes"`.
- Currently in-flight: `MS/Engines/Morphix/MorphixEngine.ts` (uncommitted edits — the
  SYM_GEO_TYPE-driven symbol editor + external `updateSymbol()` patch API).
- The library has grown well beyond the original symbol-drawing core into a full
  tactical-planning toolkit: measurement, proximity, drawing cues, MGRS grid,
  declutter (cluster/ladder/disperse/label-placement), visualization overlays,
  ~13 analysis engines, save/load + GeoJSON + PowerPoint export, undo/redo,
  selection/alignment, clipboard, templates, deployment builder, and a
  Ctrl+K command palette with modular settings widgets.
- **~124 symbol classes** live in `MS/Symbols/`.

## Key Dependencies

| Dependency | Version | Notes |
| --- | --- | --- |
| `@arcgis/core` | **5.0.19** | ArcGIS Maps SDK for JS, consumed as an ES module (not the CDN/AMD build). Assets copied to `public/assets` via the `copy-assets` script. |
| `pptxgenjs` | ^4.0.1 | PowerPoint (.pptx) briefing export. |
| `milsymbol.js` | bundled | Legacy JS lib for UEI symbols — loaded via `<script>` tag in `index.html`, exposed as `window.MS` (NOT an ES module). |
| `fabric.js` 4.5.0 | CDN | Canvas overlay (`#fabricCanvas`) for certain freehand/overlay drawing. |
| `tween.js` | bundled | Animation easing (loaded via script tag). |
| TypeScript | ^5.2.2 | |
| Vite | ^5.2.0 | Build tool + dev server; `vite-plugin-dts` emits declarations. |

## Build Configuration

- **Entry point**: `MS/Engines/SymbolEngine.ts`
- **Output directory**: `dist/MS`
- **Dev server**: `npm run dev` (Vite, port 3000) — runs `predev` → `copy-assets` first.
- **Build**: `npm run build` → `vite build && tsc -p tsconfig.build.json`.
  - Note: shipping happens through Vite. `tsc` runs against `tsconfig.build.json`
    and has pre-existing errors; when verifying a change, filter `tsc` output to the
    files you touched rather than treating the whole baseline as broken.

## Architecture

### Library Structure (`MS/`)

```
MS/
├── Data/                       # JSON metadata & defaults
│   ├── Symbols.json            # Symbol metadata (Class, Name, SymGeoType, ...)
│   ├── Settings.json           # Default settings tree (features, measurement, declutter, ...)
│   ├── Templates.json / *V3.json # Symbol templates & catalogs
│   └── ...
├── Engines/                    # Core + feature engines (see below)
│   ├── SymbolEngine.ts         # Central mediator / public API surface
│   ├── Mapper.ts               # Maps Symbols.json "Class" names → implementations
│   ├── MeasurementEngine.ts
│   ├── ProximityEngine.ts
│   ├── DrawingCueEngine.ts
│   ├── MGRSEngine.ts
│   ├── AnnotationEngine.ts
│   ├── EditEngine.ts
│   ├── SelectionEngine.ts  / SelectionActionPanel.ts
│   ├── ClipboardEngine.ts  / UndoRedoManager.ts / TemplateEngine.ts
│   ├── KeyboardShortcutManager.ts
│   ├── *SettingsManifest.ts / *SettingsWidget.ts  # Modular settings (self-register w/ Ctrl+K)
│   ├── Declutter/              # ClusterEngine, LadderEngine, MarkerDisperser,
│   │                          #   LabelPlacer, DeclutterEngine, SpatialIndex, PriorityResolver
│   ├── Visualization/VisualizationEngine.ts
│   ├── Analysis/              # LOS, WEZ, Trajectory, Buffer, Corridor, Flight, Effect,
│   │                          #   DeadGroundMapper, RoadNetwork, Trafficability, KeyTerrain,
│   │                          #   OpRanker, PosDefScorer, Peaks
│   ├── OCOKA/Ocoka.ts
│   ├── MissionPlanner/MissionPlannerEngine.ts
│   ├── DeploymentBuilder/DeploymentBuilderEngine.ts
│   ├── ImportExport/          # SerializationEngine, IOEngine, Plan
│   ├── Morphix/MorphixEngine.ts   # In-place symbol editor + updateSymbol() patch API
│   ├── AnalysisEngineRegistry.ts
│   └── Cue/MagneticCompass.ts
├── Symbols/                    # ~124 symbol implementations (.ts, many w/ legacy .js)
│   ├── TacticalPoint.ts        # Tactical point symbols (dots, text, etc.)
│   ├── UEISymbol.ts            # Unit Equipment & Installation symbols
│   ├── FreehandArea.ts / FreehandArrow.ts / ...
│   └── [Block, Breach, Boundary, AssemblyArea, AxisOfAdvance, Ambush, ...]
├── ThirdParty/
│   ├── MilSymbols/             # milsymbol.js + .d.ts + UEITypes.ts
│   ├── Tacticals/              # Tactical-graphics generator (SIDCFormatter, constants, ...)
│   ├── MGRS/                   # mgrs grid conversion lib
│   └── TweenJS/                # tween animation
├── Support/                    # Cross-cutting helpers
│   ├── Amplifier.ts            # Symbol amplifier/modifier data
│   ├── DrawEssentials.ts       # Drawing params/config (SIZE, ANGLE, opacity, ...)
│   ├── GeoTools.ts             # Geographic utilities
│   ├── SIDC.ts  / SIDC/SIDC.ts # SIDC parsing
│   ├── SettingsBus.ts          # Central settings event bus
│   ├── SettingsMenu.ts / SettingsWidget.ts / CommandPalette.ts  # ⚙ menu + Ctrl+K palette
│   ├── EngineLogger.ts         # Emits `engine-log` CustomEvents → Engine Log panel
│   ├── Echelons.ts / Shapes.ts / Shapes3D.ts / MinefieldTextureFill3D.ts / utils.ts
├── Managers/
│   ├── GraphicsLayerManager.ts # Per-view layer singleton (LAYER_NAMES, SYMBOL_LAYER_IDS)
│   ├── ContextMenuManager.ts   # Right-click menu
│   ├── ThemeManager.ts         # UI theming (Ops Dark, Night Vision, ...)
│   └── MenuIcons.ts
├── Cache/LRUCache.ts
└── PlotPoint.ts
```

### Symbol Categories

1. **Unit Equipment & Installation (UEI)** — rendered via `milsymbol.js` (`window.MS`).
2. **Tactical Point Symbols** — `TacticalPoint.ts` (dots, text, etc.).
3. **Area / Line / Freehand Symbols** — individual classes in `MS/Symbols/`.

## Key Engines & Managers

- **SymbolEngine** — central entry point / mediator. Owns initialization, view
  switching (2D↔3D), the public API surface (`window.symbolEngine`), and wires up
  all sub-engines. Sub-engines exposed as properties: `measurementEngine`,
  `proximityEngine`, `selectionEngine`, `editEngine`, `serializationEngine`,
  `contextMenuManager`, `layerManager`, etc.
- **MeasurementEngine** — live distance, slant range (3D), area, true/magnetic/grid
  azimuth, march-time ETA, and optional road-following ETA. Loaded dynamically when
  `features.measurementEngine` is set.
- **ProximityEngine** — snap indicators to nearest vertex/coordinate while drawing.
- **DrawingCueEngine** — rubber band, coordinate readout, angular guides/protractor,
  distance rings, nearby highlight, adaptive rings, magnetic compass overlays.
- **MGRSEngine** — on-demand MGRS grid overlay (GZD / 100k / 10k / 1k) for 2D & 3D.
- **DeclutterEngine** (+ Cluster/Ladder/Disperse/LabelPlacer) — zoom-aware hiding,
  cluster badges, flag-halyard ladders, radial disperse, and Maplex-style label placement.
- **VisualizationEngine** — coverage rings, force-ratio grid, convex-hull footprints,
  2D layer glow/shadow effects, 3D extruded footprints, and 3D render settings (lift,
  drop-lines, quality/atmosphere/shadows).
- **Analysis engines** (registered via `AnalysisEngineRegistry`, surfaced in the
  Analysis Hub): LOS, Weapon Effect Zone, Trajectory, Buffer & Threat Rings, Corridor,
  UAV Flight, Effect, Dead Ground Mapper, Key Terrain, OP Ranker, Position
  Defensibility Scorer, Local Peaks, OCOKA, Mission Planner, plus Road Network +
  Trafficability (optional external road-network service; degrades to estimates offline).
- **EditEngine / SelectionEngine / ClipboardEngine / UndoRedoManager / TemplateEngine** —
  in-place editing, lasso/similar selection, align/distribute, copy-paste, undo/redo,
  reusable templates.
- **MorphixEngine** — SYM_GEO_TYPE-driven symbol editor + external `updateSymbol(graphic, patch)`
  patch API (Point/Line/Area use amplifier+drawEssentials; FPoint uses OPTIONS).
- **SerializationEngine (ImportExport)** — save/load plans, JSON & GeoJSON import/export,
  PowerPoint (.pptx) export.
- **ContextMenuManager** — right-click options for drawn graphics.
- **GraphicsLayerManager** — per-view singleton creating/owning all symbol layers.

## Settings System

- Defaults live in `MS/Data/Settings.json` (tree: `features`, `measurement`,
  `proximity`, `drawingCues`, `declutter`, `mgrs`, `visualization`, `analysis`, `ui`, ...).
- Settings flow through `SettingsBus` and reach `SymbolEngine.onSettingChanged(path, value)`.
- The legacy `#settingsPanel` / `#apiPanel` overlays in `index.html` dispatch
  `settingsChanged` CustomEvents (see the `settingMappings` table in `index.html`).
- Modern modular settings: each `*SettingsManifest.ts` + `*SettingsWidget.ts` pair
  self-registers (side-effect imports at the top of `SymbolEngine.ts`) with the
  **⚙ Settings menu** and the **Ctrl+K command palette** (`CommandPalette.ts`).

## Graphics Layers (`GraphicsLayerManager.LAYER_NAMES`)

- `FORCE` (`ForceSymbolsLayer`) — UEI / force symbols
- `TACT_PT` (`TacticalPointSymbolsLayer`) — tactical point symbols
- `TACT` (`TacticalSymbolsLayer`) — tactical line/area graphics
- `ANNOTATION_LAYER` — labels & text
- `SKETCH` — temporary sketch graphics
- `CLUSTER`, `LEADER_LINE`, `LADDER` — declutter overlays
- `LEGACY_MIL_SYMBOLS_LAYER_ID = "milSymbols"` — legacy milsymbol.js 3D pipeline.
  `SYMBOL_LAYER_IDS` is the canonical "every symbol layer" list (FORCE first for priority).

## Working with the Codebase

### Adding a New Symbol

1. Add metadata to `MS/Data/Symbols.json`:

```json
"KEY": {
    "Class": "SymbolClassName",
    "Name": "Display Name",
    "SymGeoType": "Point|FPoint|Polyline|Polygon",
    "Parameters": [...]
}
```

2. Create the symbol class in `MS/Symbols/` (TS; many legacy symbols also have a `.js`).
   - Constructor pattern `(view, isLine?)`, implement `init()`.
   - Emit `onDrawProgress` / `onDrawEnd` events.
3. `Mapper.ts` maps the `Class` name → implementation.

### Symbol Event System

Symbols emit `onDrawProgress` (during) and `onDrawEnd` (complete) — bubbled as
CustomEvents to `document` for `SymbolEngine` to catch.

### SIDC (Symbol Identification Code)

- Parsed by the `SIDC` class (`MS/Support/SIDC.ts`, also `MS/SIDC/SIDC.ts`).
- Format `PPASSSSHHAEEEEEE...`: PP coding scheme, A standard identity, SSSS symbol set,
  H status/HQ/modifier, A amplifier, E entity.

### Drawing Flow

1. User picks a symbol (Symbols.json metadata).
2. `SymbolEngine.initialize()` creates the instance via `Mapper`.
3. Symbol drives interactive drawing (`SketchViewModel` or direct handlers).
4. On completion the symbol emits `onDrawEnd`.
5. `SymbolEngine.drawSymEnd()` builds the final `Graphic` and adds it to the layer.
6. `AnnotationEngine` adds labels if applicable.

## Common Patterns

### Creating a Symbol Programmatically

```typescript
const symbolEngine = new SymbolEngine(() => activeView);
const amplifier = new Amplifier();
amplifier.SIDC = '10110201004100000000';

const drawEssentials = new DrawEssentials();
drawEssentials.SIZE = 60;

symbolEngine.initialize(drawEssentials, amplifier);
```

### Editing a Symbol via Morphix

```typescript
const state = symbolEngine.getSymbolState(graphic);          // { kind, sidc, options, ... }
symbolEngine.updateSymbol(graphic, { amplifier: { UNIQUE_DESIG: 'B/1-7' } });
// FPoint symbols patch OPTIONS instead: { options: { uniqueDesignation: 'B/1-7' } }
```

### Handling View Switch (2D ↔ 3D)

```typescript
reactiveUtils.watch(
  () => this._getView()?.type,
  (newType: string | undefined) => {
    symbolEngine.onViewChanged(newView);
  },
);
```

## Testing

The harness is `src/main.ts` + `index.html`, which:

- Create 2D/3D views and instantiate `SymbolEngine` (`window.symbolEngine`).
- Provide the top info bar, **Settings panel**, **API Test panel**, **Analysis Hub**,
  **Engine Log panel**, measurement panel, and declutter perf HUD.
- Exercise autocomplete/search and the full public API.

## File Naming Conventions

- `.ts` — TypeScript implementations (newer / canonical).
- `.js` — legacy JavaScript originals for some symbols.
- `.d.ts` — declaration files.
- `__` prefix — private/internal classes (e.g. `__Contain.ts`).
- `____` prefix — base/abstract classes (e.g. `____UEISymbol.ts`).

## Important Notes

1. `@arcgis/core` is the **npm ES-module** SDK (v5.0.19); assets are copied to
   `public/assets` by the `copy-assets` script before dev/build.
2. `milsymbol.js` is loaded via a `<script>` tag (not ESM); access it via `window.MS`.
3. Symbol classes must emit global CustomEvents for `SymbolEngine` to catch them.
4. `dist/MS` holds the production build.
5. **Keep `index.html` + `src/main.ts` in sync** with new MS utilities/features — the
   API Test and Settings panels are the manual test surface. New engine settings
   should also register a `*SettingsWidget`/`*SettingsManifest` for the Ctrl+K palette.
6. Optional analysis features (road network / trafficability) rely on an external
   service and degrade gracefully to straight-line estimates when offline.
