# PAMS8 - Military Standard 2525D Symbol Drawing Library

## Project Overview

PAMS8 is a TypeScript library for drawing **MIL-STD-2525D** tactical symbols on maps,
built on the **ArcGIS Maps SDK for JavaScript** (the `@arcgis/core` ES-module package).
It draws unit/equipment & installation symbols, tactical point/line/area/freehand
graphics, and layers a large suite of analysis, measurement, decluttering, and editing
engines on top. It runs in both **2D (MapView)** and **3D (SceneView)**.

## Status (as of June 2026)

- **Active development** on `master`. Last tagged checkpoint: `6971f1c "Before Huge changes"`.
- The library has grown well beyond the original symbol-drawing core into a full
  tactical-planning toolkit: measurement, proximity, drawing cues, MGRS grid,
  declutter (cluster/ladder/disperse/label-placement), visualization overlays,
  ~13 analysis engines, save/load + GeoJSON + PowerPoint export, undo/redo,
  selection/alignment, clipboard, templates, deployment builder, and a
  Ctrl+K command palette with modular settings widgets.
- **~160 symbol classes** live in `MS/Symbols/` (1007 catalog entries in `Symbols.json`).
- PAMS8 is consumed as a **library by multiple host applications** — public APIs must
  stay headless, engines must be individually tear-down-able
  (`SymbolEngine.destroy()` / `removeGlobalEventListener()`), and document-level draw
  events are scoped to the emitting view's container.

## Key Dependencies

| Dependency | Version | Notes |
| --- | --- | --- |
| `@arcgis/core` | **5.0.19** | ArcGIS Maps SDK for JS, consumed as an ES module (not the CDN/AMD build). Assets copied to `public/assets` via the `copy-assets` script. |
| `pptxgenjs` | 4.0.1, bundled | PowerPoint (.pptx) briefing export — offline browser bundle at `MS/ThirdParty/PptxGenJS/pptxgen.bundle.js`, injected as a `<script>` tag on first export (NOT the npm ES module), exposed as `window.PptxGenJS`. |
| `milsymbol.js` | bundled | Legacy JS lib for UEI symbols — loaded via `<script>` tag in `index.html`, exposed as `window.MS` (NOT an ES module). **Customized fork of v0.5.6** ("Edited by Abdul Razak, Sep 2016") — do NOT swap in the stock npm/dist build; local changes would be lost and the modern API differs (`ms.Symbol` vs `MS.symbol`). |
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
│   ├── PptxGenJS/              # pptxgen.bundle.js — offline PowerPoint export, script-tag loaded
│   ├── Tacticals/              # Tactical-graphics generator (SIDCFormatter, constants, ...)
│   ├── MGRS/                   # mgrs grid conversion lib
│   └── TweenJS/                # tween animation
├── Support/                    # Cross-cutting helpers
│   ├── Amplifier.ts            # Symbol amplifier/modifier data
│   ├── DrawEssentials.ts       # Drawing params/config (SIZE, ANGLE, opacity, ...)
│   ├── GeoTools.ts             # Geographic utilities + geodesic chokepoint
│   │                           #   (supportsGeodesic / metersToMapUnits /
│   │                           #    geodesicCircle / geodesicSector)
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
- **GroundGuide** (`Engines/GroundGuide/`) — optional, off by default
  (`features.groundGuide`). Live "deployable terrain?" advice while drawing
  (ok / near / caution / partial / in), driven by a static **terrain bundle**
  (PNG tiles + `rules.json`) the host serves; built offline by
  `tools/terrain-pipeline/` into `MS/Data/terrain-bundle/` (git-ignored, multi-GB; `npm run dev` serves it at
  `/terrain-bundle`). Hot path is synchronous typed-array reads (no I/O on
  mouse-move); advise mode only listens, enforce mode vetoes in `drawSymEnd`.
  Tile fetch/decode and overlay painting run in an inline Web Worker
  (`groundGuide.useWorker`, falls back to the main thread automatically).
  Land-unit echelons (section → brigade) are judged on their **footprint** (frontage × depth, centred on
  the symbol; `groundGuide.footprint.*`, facing = fixed bearing / worst-of-4 / circle) rather than the click
  point, with an advisory intergap check against same-echelon symbols already on the map
  (`GroundGuideFootprint.ts`, table overridable via rules.json `echelons`).
  Advice names the reason, distance, nearest terrain and direction; an optional
  map overlay (`groundGuide.overlay.*`) paints go / near / caution / no-go per profile,
  and indicator lines (`groundGuide.indicators.*`) join the symbol to the contested terrain.
  The terrain bundle is clipped to the **official Survey of Pakistan boundary** (all of Jammu &
  Kashmir on Pakistan's side, built from NCGDB by `make_boundary.py`); `groundGuide.overlay.boundary`
  draws the outline the bundle ships.
  The card also lists **Important Tactical Ground (ITG) candidates** (G in GROTBC, not a letter of its own) from the
  bundle's `features/` (`GroundGuideFeatures.ts`, `guide.groundCandidates()`); the bundle only proposes candidates,
  and `symbolEngine.designateGround(target, 'ITG' | 'MITG')` lets the user designate it as an ordinary symbol:
  Imp Gr ("IG", `MS/Symbols/ImpGr.ts`, catalog key `00000160`, a local non-2525D symbol) or Vital Gr ("VG").
  B also carries **people round the cursor** (`population.*`, `GroundGuidePopulation.ts` / `GroundGuidePopulationView.ts` /
  `GroundGuidePopulationLayer.ts`): WorldPop 2026 from the bundle's population grid, shown in any of ten card styles
  kept side by side for comparison (`ground-guide-population-options.html`), a civil flag per mode, a People map layer
  and a Ground Brief block; `guide.populationAround()` for hosts. Estimates, not a census.
  T in GROTBC is **Trafficability**: the going engine (`going.*`, `card.*`, `GroundGuideGoing.ts`) gives the going dry
  and after rain; `traffic.*` (`GroundGuideTrafficability.ts` / `GroundGuideTrafficView.ts`) adds the road line, legend
  season controls, an overlay and (opt-in) verdict that follow the season, and the soil rule — all kept as options to compare.
  T also gives **speed** (`speed.*`, `GroundGuideSpeed.ts` / `GroundGuideSpeedView.ts`): cross-country and road km/h for the
  symbol's mover, day / night, dry / after rain, from `MS/Data/MovementSpeeds.json` (a starting proposal: Pakistani infantry
  table for foot; Tobler on slopes for foot, a factor per slope band for vehicles); movers come from the SIDC mobility amplifier,
  else Symbols.json `Mover` (vehicles also carry `VehCat` A / B / C), else the profile; five card styles S1–S5, `guide.speedAround()`.
  C in GROTBC is **Cover, Camouflage & Concealment** (`cover.*`, `GroundGuideCover.ts` / `GroundGuideCoverView.ts`):
  cover from direct / indirect fire and concealment from ground / aerial observation at the point (class split
  `grotbc.coverSplit`, raised by river and canal banks, `cc` local density beside it), the nearest better cover and a
  rose, in seven card styles kept to compare (`ground-guide-cover-options.html`); `guide.coverAround()` for hosts.
  The **G / R / B / W sections** (`sections.*`, `GroundGuideSections.ts` / `GroundGuideSectionsView.ts`) show the layers
  the card used to skip: terrain type, relief, slope, landform, high ground, named areas and water (GeoNames included);
  the route here with the rules check for the mode (class not recorded = not tankable until checked) and road network
  density round it (`GroundGuideRoadDensity.ts`, `guide.roadDensityAround()`: km/km², all-weather share, ways out; seven card
  styles D1–D7 in `GroundGuideRoadDensityView.ts`, compared in `ground-guide-road-density-options.html`); buildings, huts,
  services, security; the month's weather. Compact on the card by default, in full in the Brief; `guide.sectionsAround()`.
  G also works out, in the browser from the bundle's 30 m elevation, the way the slope faces, how broken the surface is
  and the **military crest** (a real top-to-foot profile, drawn by G3), and reads NCGDB dune fields (Soil_Line /
  Soil_Point), ground symbols and the sheet's own notes (Annotation_: "Jeepable", "Brackish"); O adds OSM power lines,
  pipelines and walls and the recorded dam structure (kinds 167–181, 205–207; see `15-ground-guide.md`).
  **V** shows / hides the **Gr Scope** rail (`GroundGuideScope.ts` view, `GroundGuideScopeScene.ts` pure scene,
  `groundGuide.scope.*`): a side window docked at the map's edge, not tied to the mouse, whose map shows the ground round
  the symbol being placed (else the selected symbol, the one just placed, the map centre) with range rings, the frontage
  for the echelon, clear ground and the GROTBC layers from the bundle, thinned per echelon; its legend lines are the
  layer switches. `guide.showScope()`, `guide.setScopeTarget(graphic)`.
  **Shift+V** switches the rail to its **AOR scale** (`groundGuide.aor.*`; `GroundGuideAor.ts` pure engine,
  `GroundGuideScopeAor.ts` rail view, `GroundGuideAorSheet.ts` D sheets): the area of ops read as an appreciation's Gr and
  Weather (AprDf headings, Vs72 marking). It gives three approaches ranked (the Extended View's `findAvenue` on a class grid that keeps
  canals and bridges), lines of def W X Y and Z through the MITG with roles and the frontage test, the MITG, bridges to
  demolish, the MSR and laterals, and NO-GO / SLOW-GO only. The AOR comes from Bdy symbols, a dragged box or the echelon
  frame; the MITG is a VG symbol, else the selected symbol or the map centre. Layout A/B/C, Trace/Dark and North/Threat up
  switch on the fly from the rail's foot. `guide.setScopeScale()`, `setAor()`, `aorReading()`, `aorText()`. Mockup:
  `ground-guide-aor-options.html`.
  **F** turns the **Extended View** on and off (user, 2026-11-12; it replaced the separate OCOKA lens, and the name OCOKA is
  not shown any more). It is NOT kept in the settings: it starts off, F or turning the guide off clears it, and nothing in it
  is worked out while it is off. On, it adds to GROTBC (`groundGuide.extended.*`; `GroundGuideExtendedView.ts` the cards,
  `GroundGuideOcoka.ts` the pure engine, `GroundGuideOcokaRead.ts`, `GroundGuideThreat.ts`): Detail tabs **1 Obsn & Fd of
  Fire**, **2 Key Gr** (ITG candidates ranked: strong, higher, on an approach, toward the threat, in view; a round Key Gr map,
  the lead as a card, a height ladder), **3 Approaches**, all before the Legend (off: a dashed F tab says what it adds); a
  tile on the threat's side in O and C; a short block on the cursor card and F / J on its foot; the threat marker (the unit's
  front by default or dragged on the map, never enemy symbols; [ ] turn it). Sight is a chance (30 m elevation plus building
  density, crops by month, trees, bunds), weapon ranges come from `Rng` in `Symbols.json`, figures and rules from
  `MS/Data/OcokaDoctrine.json` (pamphlet figures and marked proposals), the month's visibility from the bundle's NOAA grid;
  enforce mode stays on the GROTBC rule. While placing, it draws on the map (`GroundGuideOcokaMap.ts`, `extended.map*`): the
  fire fan with dead (red) and screened (amber) ground, lines of sight to the ITG candidates, the threat's own view when it is
  a place, the approaches with chokepoints for the frontage, and a better position nearby that **J** takes
  (`guide.takeBetter()`). The Gr Scope rail gets its Extended mode (`GroundGuideScopeOcoka.ts`; legend rows 1 C O 2 3). The H
  chip adds the fields of fire and the better position; the map overlay (`extended.overlay`) paints all the threat may see
  (violet) or the view from the position (light blue) instead of the going. Copy as Text adds its lines under the GROTBC brief
  (`guide.extendedText()` for hosts). `guide.setExtended()`, `toggleExtended()`, `extendedAround()` (`map: true` returns the
  geometry); `node tools/ocoka-test/run.mjs` runs the engine's 44 checks.
  See `15-ground-guide.md`. `node tools/terrain-synth.mjs` makes a
  synthetic dev bundle.
- **MovementGuide** (`Engines/MovementGuide/`) — optional, off by default (`features.movementGuide`; top-bar Mov Guide).
  Nine cards, NOT tied to symbols: Cordon (click a town / draw area: platoon sectors, rooftop + side-road posts, road
  blocks, people inside), Picket (route picketing both sides / piqueting fewest posts, up-by times, check posts, clear
  first, casevac), Convoy (packets, SP/RP times, bounds at safe halts), Mines, Patrol (A* route out + different route in,
  night march chart via PlatoonGuide `patrolCard`), Ambush (sites + line/L/V layout), Rd Block (+ flanking positions),
  Infil (lanes through unseen ground + anti-infiltration posts), Water (key 9: the water obstacle as IBB Annex P types
  it, home vs far bank, tank / wheels / foot check, crossings, recce list; point / axis / reach; pure engine
  `MovementGuideWater.ts`, `node tools/movement-test/water.mjs`; a 350 px cursor card over water in three styles cycled
  with Q, and lenses Type / Section / Banks / Going / Crossings / Recce / Reach walked with 9 again; W is the Night March's). Own draw tool (`MovementGuideDraw.ts`); "Create on Map"
  makes ordinary symbols via `loadSymbolFromJSON`; Copy as Text per card. Pure engines `MovementGuideScan.ts` +
  `MovementGuidePlans.ts` (Node: `node tools/movement-test/run.mjs`, `plans.mjs`), bundle reader `MovementGuideProbe.ts`,
  figures `MS/Data/MovementDoctrine.json`. See `MS/Docs/17-movement-guide.md`.
- **PlatoonGuide** (`Engines/PlatoonGuide/`) — optional, off by default (`features.platoonGuide`). The field soldier's
  Ground card at a point (OCOKA_Roadmap.md ch. 8) for Team / Sec / Pl / Coy, read under the cursor (`platoonGuide.hover`,
  ⌖ button), while such a land unit is placed, on the selected one, or right-click "Pl Guide: Gr Card…"; a selected
  line gets the patrol route card (`patrolCard()`). Shown like the Ground Guide's cards: a 350 px **cursor card**
  (`PlatoonGuideCard.ts`: going on foot in the verdict ladder; the **bubble radar** (`PlatoonGuideRadar.ts`: sight to
  true scale, way-out arcs on the rim, glyphs for water / dangers / casevac / help / BUA / PB / OP, log band beyond the
  bubble) beside stat tiles; a danger strip with severity meter and glyph chips; a people strip with spark bars; hidden
  while the Ground Guide's card owns the cursor) and the **Pl Detail** docked at the foot (`PlatoonGuideDetail.ts`: tabs Here /
  See / Danger / People / Help / Stop / Patrol, each with its answer; answer strip; tiles in columns that page, never
  scroll; **A** opens it and walks pages then tabs, Shift+A back, Esc closes). Colours and sizes from
  GroundGuideTokens.ts, arrows and roses turn with the map (GroundGuideNorth). Bubble by echelon 300 m / 500 m / 1 km /
  2 km; quick reads per move, full at rest (350 ms). Map layer `ms-platoon-guide`. Pure engine `PlatoonGuideRead.ts`
  (`node tools/platoon-test/run.mjs`, 54 checks), bundle reader `PlatoonGuideProbe.ts`, figures
  `MS/Data/PlatoonDoctrine.json` (R / E basis). The Movement Guide's Patrol card calls `patrolCard`: keep `PlProbe`,
  `plRulesFrom`, `PatrolCard`, `PlLeg`, `PlFootSpeeds` and `patrolCard` stable.
- **NightMarch** (`Engines/NightMarch/`) — optional, off by default (`features.nightMarch`; info bar 🌙 Nt March / ✎ / ⚙).
  The night march chart (OCOKA_Roadmap.md ch. 2): draw SP → turns → double-click FUP → click Obj; legs with grid /
  magnetic (`nightMarch.gmaDeg`) / mils bearings, paces (120 = 100 m), time by night, landmarks, check points on long legs;
  FUP + SL laid square to the axis with places, lamps, guides and marking stores; timings back from H (`nightMarch.hHour`);
  enemy night-sight / thermal rings round the Obj. Cursor card while drawing (`NightMarchCard.ts`: dial with drift cone, pace
  cord, Obj ruler) and on a finished route; chart docked at the foot (`NightMarchChartView.ts`) in six styles Chart / Strip /
  Cards / Trace / FUP / Clock, **W** walks pages then styles, Shift+W back, Esc closes. Terrain optional (`nightMarch.useTerrain`:
  reuses `patrolCard` + the Movement Guide scan; off = geometry on open ground). Pure engine `NightMarchRead.ts`
  (`node tools/nightmarch-test/run.mjs`, 52 checks), figures `MS/Data/NightMarchDoctrine.json` (R / E). See `MS/Docs/18-night-march.md`.
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

New tactical line/area symbols should **extend `MS/Symbols/____TacticalSymbolBase.ts`**
(see `PhaseLine.ts` for the pilot migration): the base owns the interactive-draw
scaffold, the three `init()` placement modes, DrawEssentials assembly, event
emissions and cleanup — a subclass supplies its identity (config) and geometry
(`createSymbol()`). Most legacy classes still carry their own copy of that
scaffold; migrate them opportunistically when touching one.

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
- `.d.ts` — declaration files.
- `____` prefix — base/abstract classes (e.g. `____TacticalSymbolBase.ts`, the
  shared line/area draw scaffold that new symbol classes should extend).

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
7. **Geodesic correctness**: live views report Web Mercator as wkid **102100** —
   never test `wkid === 3857` alone; use `GeoTools.supportsGeodesic()` /
   `GeoTools.isWebMercatorSR()`. Anything that converts real meters ↔ map units
   must go through `GeoTools.metersToMapUnits()` (cos-latitude corrected), and
   metric shapes (range rings/fans) through `geodesicCircle()`/`geodesicSector()`
   so they agree with the (geodesic) MeasurementEngine.
8. Never `btoa()` SVG that can carry label text (throws on non-Latin-1, e.g. Urdu) —
   use `Utils.svgToDataUrl()`. User-supplied text interpolated into `innerHTML`
   goes through `Utils.escapeHtml()`.
