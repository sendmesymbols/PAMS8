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
│   ├── Orbat/                  # Unit compositions from SO's Handbook 2019 (RESTD): own + en units, strength,
│   │                          #   children (who is under whom), weapons → weapons.json (printed ranges + planRangeM),
│   │                          #   symbol keys; `node tools/orbat-test/run.mjs` checks it
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
  switch on the fly from the rail's foot. `guide.setScopeScale()`, `setAor()`, `aorReading()`, `aorText()`; `setAorDenial('X' | null)` marks the line of denial the higher comd gave on the trace, the Lines row, the D sheet and Copy as Text (not kept in the settings; the Aprc passes its own). Mockup:
  `ground-guide-aor-options.html`.
  **F** turns the **Extended View** on and off (user, 2026-11-12; it replaced the separate OCOKA lens, and the name OCOKA is
  not shown any more). It is NOT kept in the settings: it starts off, F or turning the guide off clears it, and nothing in it
  is worked out while it is off. F lasts for the kind of symbol it was opened on (`extended.lasts: symbol`): arming a
  different kind or cancelling the draw closes it (`once` / `kept` also offered); Shift+F keeps it on for every symbol; it
  rests (reads nothing) while a line or area is drawn. On, it adds to GROTBC (`groundGuide.extended.*`; `GroundGuideExtendedView.ts` the cards,
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
  The overlay's **`ipb`** choice (`extended.overlay: ipb`, `extended.ipb.*`; `IPB_Plan.md` Phase 1) codes GO / SLOW-GO / NO-GO
  by the C&SC IPB book's criteria only (slope uphill along the movement, relief per km, BUA width / bypass, water vs the AVLB
  span, vegetation, roads in close country, season rules), never filled from GROTBC: what the bundle cannot tell is "not
  assessed". Book's marking (crosshatch / parallel lines) as one MediaLayer `ms-ground-guide-ipb`; only while F is on.
  Pure engine `GroundGuideIpb.ts`, painter `GroundGuideIpbMap.ts`, figures `MS/Data/IpbDoctrine.json` (D / T / E / U, page
  cited); `guide.ipbCodingAround()`, `ipbReasonAt()`; `node tools/ipb-test/run.mjs` runs its 43 checks. Obstacle symbols
  drawn on the map (minefields, DCB / AT ditch / wall, wire; lanes, breaches and bridges open them) join the coding as
  man-made NO-GO for the movers they stop (`IpbDoctrine coding.manMade.symbols`), part of the area's code key; own
  obstacles no own weapon reaches are named "not covered by own fire" (ATP 4-14).
  With F on, **`extended.ipb.apchs`** (Phase 2) reads the HQ's area facing the threat (Bde HQ: Bn avenues of Coy 500 m
  corridors, 2 km apart, 14 x 28 km; Div HQ: Bde of Bn 1.5 km, 6 km, 30 x 48 km; a Bn reads with the Bde row) for mobility
  corridors and avenues of approach: least-cost ways from strips of the area, an avenue = two corridors side by side,
  narrows, crossovers; drawn as the MS attack arrows (layer `ms-ground-guide-ipb-apch`), in tab 3 (replacing the single
  path), on the rail. Pure engine `GroundGuideIpbCorridors.ts`, map `GroundGuideIpbApchMap.ts`, tab 3
  `GroundGuideIpbApchView.ts`; `guide.ipbApproaches()`, `ipbApproachesAround()`; `node tools/ipb-test/corridors.mjs` (55 checks).
  Review fixes (24 Nov 2026): the slope is judged along each way's own heading from the elevation (a cell coded for slope
  alone is passable; SLOW-GO, and a climb at the SLOW-GO figure, weigh the book's day ratio for the mover, GO over SLOW-GO
  km/h (vehicles 1.5, foot 1.67; 3 without the rates; user, 24 Nov 2026), a climb at NO-GO is impassable, diagonal steps judged by
  their components; a 'steep' narrows with its %), the free width is measured square to the way, strips are one avenue
  wide (Bde 5, Div 4 on open ground), two ways through one narrows are one avenue, the turning approach ranks first only
  while the way round is as good going (bonus 15-30 by cost), the book's day time is in the rank (8 points an hour) and the
  reasons (`hoursDay`, `steepPct`); the enemy's mover is read off his symbols in the area (`_enemyMoverIn`, armour when none).
  **Y** (`ipb.apchEnd`: `objective` default / `through` / `both`): approaches onto the objective's frontage by its echelon
  (your symbol in the en's options; the Threat marker place or the nearest en symbol ahead in yours), frontal and Lt / Rt
  flanking from an FUP `ipb.fupM` (1,100 m) short, flanks first, the last 3 km on their side, and (`ipb.turn`) a turning
  approach round the objective to a choke on the MSR behind it (road network MSR flag, `GroundGuideRoads.edgesIn`; bridge >
  defile > junction), ranked first; or the book's avenues through the area (they may pass the Posn); fire, decision,
  template and proforma follow them. The objective's frontage comes from the books by side, echelon and the ground at it
  (`GroundGuideFrontage.ts`, OcokaDoctrine `frontage.objective` over `frontage.rows`; `node tools/ipb-test/frontage.mjs`, 36
  checks; 24 Nov 2026): own Coy / Pl / Sec never extended (IBB S59 para 6 b p 326), a Bn 3000-5000 m in the plains (IBB S53
  para 4 c p 277), IBB's extended two-up row in the desert and mountains (DW pp 24, 56; MW pp 148, 150: no figure printed),
  IBB Annex V on a canal or ditch (x = yards); the En's own figures (IDD p 3 on the bund, IC s113 / s114 Foxland), the own row
  standing in where none is printed, said so. Tab 3's Read As and Copy as Text give the Obj frontage and the assault frontage
  by night with what the books say by day (IBB S47 para 17 a p 248; OOW2 s9 p 36; DW p 47; MW p 79), with book and page;
  never on map labels.
  Tab 3's **Create on Map** (Phase 3; `guide.createIpbOverlay('coo' | 'corridors' | 'apchs' | 'all')`) writes them as
  ordinary symbols via `loadSymbolFromJSON` (SymbolEngine passes `setCreator`, run as one undo step; making it again
  replaces the last set): No Go / Slow Go areas traced from the coding (`GroundGuideIpbShapes.ts`, `node
  tools/ipb-test/shapes.mjs` 11 checks), Mob Corridors lines, Main Attk / Sp Attk arrows (or Avenue of Apchs, `ipb.createAs`).
  Arrow heads keep their shape (`arrowHeadFrac` / `arrowTail`). The written symbols carry the whole route as CTRL_PTS (the
  curve) and the width on the ground as BASE_LN_PTS; Main Attk, Sp Attk and Avenue of Apchs read BASE_LN_PTS for their tail
  width (`GeoTools.tailFactorFromBaseLine`) and store the TAIL_FACTOR it gives.
  Phase 4: **fire corridors** (`ipb.fire`, `GroundGuideIpbFire.ts`): the other side's Posns on the map (catalogue `Rng`) over
  each avenue: under fire / screened / dead / out of range, gaps, killing area candidates; tab 1 tiles, map colouring and
  range rings (`ipb.mapFire`), rail line 1. **Proforma** (`ipb.proforma`, `GroundGuideIpbProforma.ts`, book p 21): rows a-l,
  this side's avenues and the other side's over the same area, suggested signs (median), user signs by click; tab 3.
  `node tools/ipb-test/fire.mjs` (21 checks).
  Tab 3's **Forms of Manoeuvre** (your options onto an Obj; `GroundGuideIpbForms.ts`, `node tools/ipb-test/forms.mjs` 9
  checks): the assailable-flank test off the coding beside each flank (`formsOfManoeuvre.reading`, E), then turning /
  double envelopment / envelopment / vertical / infiltration / penetration / frontal ranked with main and fixing approaches
  (OoW Vol II s6, MW p 79; frontal last, the user's rule). Tab 3's **Left or Right** (your options onto an Obj; `GroundGuideIpbCompare.ts`, `node tools/ipb-test/compare.mjs` 8
  checks): the left flanking approach against the right by the IC s15.12 b factors (`ownAttack.factors`, weights 0-3 the
  user sets, `ipb.lrWeights`), cells 0-100 with reasons, frontal for reference; unread factors score 0.5 and never decide.
  Phase 5: **decision support** (`ipb.decision`, `GroundGuideIpbDecision.ts`): the enemy's time along each avenue at the
  book's rates (p 18; earliest day + unassessed as GO, latest night + SLOW-GO; from the Threat marker's place), NAIs,
  TAIs (crossings, narrows under a corridor), DPs 2 h before each TAI (p 30, + `ipb.reactionH`) and a counter-attack DP
  before the depth localities; new tab **5 Decision** (time ladder, decision support picture, decisions, event matrix),
  map stars (`ipb.mapDecision`), rail line 5, Create on Map NAI / TAI / Decision Pt; **Annex A** weather (`annexA`: GSOD
  visibility, WorldClim temperature / wind; tiles Wx for Fire in tab 1, Wx for Mnvr in tab 3). `node
  tools/ipb-test/decision.mjs` (39 checks). COA 1 most likely / COA 2 most dangerous (`decisionPoints.coa`, E; ATP 2-01.3
  6-7..6-13) with the NAI that confirms each; entry NAIs are lines across the avenue (ATP 6-20). On foot the times add the MW p 81 climb (30-60 min per 300 m of ascent from
  the grid's elevation along the avenue; vehicles pay nothing), the same figure the Intelligent Deployment tab's moves pay.
  With F on the Gr Scope rail draws at the area read's scale (`scope.extScale: area`): centred on the area, the symbol and
  its rings where the symbol is (`ScopeFrame.spot`).
  Phase 6: **air** (`ipb.air`, `GroundGuideIpbAir.ts`; tab **4 Air** `GroundGuideIpbAirView.ts`): least-cost low-level air
  avenues (seen from the other side's Posns at the top of the band, masts, power lines, valleys, features along the flight),
  LZ (landing points of `lzClass` x `lzPoints`, slope 7° / 4° in mountains, 10 : 1 approach, existing helipads first) and DZ
  ranked, OPs over the enemy's LZs, AD sites for long-range / flank / bottom shots, flight profile, Wx for Air; map
  (`ipb.mapAir`), rail line 4, Create on Map 'air' (LLTR, LZ, DZ, SHORAD EZ, OP); figures `IpbDoctrine.json air` (US T
  figures to confirm); `guide.ipbAir()`; `node tools/ipb-test/air.mjs` (33 checks). Review fixes (24 Nov 2026): the 10 : 1
  approach test counts the ground rising beside the LZ; existing helipads / airfields are favoured for own LZs only; the
  other side's AD symbols on the map (`Rng.ad`, `hisAd`, cost `air.cost.ad`) are a cost on the air avenues. **Airspace
  measures and gun-target lines** (`ipb.airspace`, `GroundGuideIpbAirspace.ts`, `node tools/ipb-test/airspace.mjs` 31 checks;
  24 Nov 2026): the 2525D ROZ / HIDACZ / ACA / engagement-zone symbols on the map read over each air avenue (share inside;
  what each means for the side that flies, `IpbDoctrine airspace`, FM 3-09 2024 App B pp B-9, B-20, B-27; joint definitions
  unverified) and own gun-target lines from PAA / artillery symbols to the targets (Obj and his Posns, or TAIs and the Threat),
  avenues crossing or within 500 m (E) flagged; tab 4 tile, rail row, text, dotted lines and ✕ marks on the map.
  **Wind** (`ipb.wind`, `GroundGuideWind.ts`, `node tools/ipb-test/wind.mjs` 34 checks; 24 Nov 2026): the bundle's wind grid
  (`grotbc.wind`: ERA5 1990-2019 normal, 0.25°, four hours a day, from the WeatherBench 2 copy; patched into the live bundle by
  `add_wind_to_bundle.py`, no rebuild) gives the usual direction, steadiness and day / night turn; in Annex A (direction beside
  WorldClim's speed, where smoke drifts: IBB p 109, OoW Vol II p 93), each LZ's run-in from downwind and departure upwind on its
  10 : 1 approaches (FM 3-21.38, T, unverified), each DZ's drift and proforma g (`IpbDoctrine wind`).
  **Doctrine review applied** (24 Nov 2026, `Doctrine_Review.md` R1-R64; `node tools/ipb-test/review.mjs` 27 checks): mountain
  foot rates and descent in the Decision tab (MW p 81, `_ipbMountain`), the En FUP as a TAI, the Indian reserves ladder (IDD
  p 5), the Indian Bde defence by IDD pp 2-5, `def-desert` / `def-mtn` templates (`desertTest`), firm desert LZs (DW p 66),
  image intensifiers nil in haze / fog (IBB p 13), MW mountain foot and mule figures, desert going after rain (MIB p 261),
  the M113's 60 % grade, 81 mm min 550 m, the AD triple Anza only; see 15-ground-guide.md for what stayed data only.
  Phase 7: **situation templates** (`ipb.template` auto | id | off, `GroundGuideIpbTemplate.ts`, tab 5 page 2
  `GroundGuideIpbTemplateView.ts`): a doctrinal template from `MS/Data/IpbTemplates.json` (IDP Bde CC, DSF Div BG, Strike
  Corps bridgehead, Mtn Div attack, Inf Bde / Inf Div defence; KYE-2019, OoW, DW, IBB figures with pages; Fig 6 / 7 readings
  unconfirmed) laid along the avenues, each element judged on its mover's IPB coding (tanks off NO-GO, guns off hills),
  moved to the nearest usable ground, known enemy symbols never moved; template phases; map (`ipb.mapTemplate`), rail row,
  Create on Map 'template'; `node tools/ipb-test/template.mjs` (33 checks).
  **X** (with F on) or the *Whose options* switch at the left of the Ground Detail's key bar turns the reading between the
  en's options against you (`readFor: defence`) and yours against the threat (`attack`). A mode key (F, Shift+F, X, [ ], J,
  V, Shift+V, H, P) shows the **key notice** at the foot of the screen for 5 s: the mode now and the keys that work in it
  (`card.keyNotice`, `GroundGuideKeyNotice.ts`). Map labels are drawn at 85 % opacity (`LABEL_OPACITY`; 50 % was too dim). With F on, dropping the symbol (or Esc) takes every Extended View product
  off the map until the next draw (a selected symbol still shows its reading). Every line, circle and area on both Extended View layers
  carries a small label (`ipb.labels`), decluttered per zoom; the threat marker docks on the threat's side clear of host bars.
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
  line gets the patrol route card (`patrolCard()`). Nothing covers the ground (user, 2026-11-13; views 1 2 3 of
  `platoon-guide-view-options.html`): the **halo** round the cursor (`PlatoonGuideHalo.ts`, `platoonGuide.cursor: halo`:
  way out on foot / veh as a ring, the answers in the direction they lie with a short word and distance (Wtr 340 m), the
  verdict above; on the map the same icons carry the same word under them (`GLYPH_CODE`: Wtr, IED, Amb, HLS, Hosp, Pol /
  Post / BOP / Fort / Cantt, BUA, PB, OP...; help is a lifebuoy, BUA a building) and the search radius is a dotted ring
  with its distance; the old
  350 px card `PlatoonGuideCard.ts` with the **bubble radar** `PlatoonGuideRadar.ts` is `cursor: card`; neither shows while
  the Ground Guide's card owns the cursor); the **answer bar** (`bar`): the **Pl Detail** (`PlatoonGuideDetail.ts`) folded
  to its tab row at the foot, every tab's answer at once; a tab click opens the Detail on it, each tab led by its big
  picture (Here: the radar, See: what you see, Danger: on the Rds round you, Help: nearest help, People: where the people
  are, a population-grid map with ring counts; Stop: where to stop, the bubble on its grid with each site coloured by the
  test that ruled it out, the PB, next best sites and the OP with its view; People also has rings to scale, a direction
  rose, density by distance and an ages waffle; Stop a PB checklist, the rule-out funnel and the OP's view rose; keys one
  item to a line), answer strip, tiles in columns that page (wheel or ‹ ›), never scroll; the **pin**: **A**, or the pointer
  onto the bar, holds the reading where the cursor last rested (a pin on the map) so the mouse can leave the map; A again
  walks the tabs, Shift+A back, Esc folds the Detail and lets the pin go, placing the symbol lets it go. Colours and sizes from
  GroundGuideTokens.ts, arrows and roses turn with the map (GroundGuideNorth). Bubble by echelon 300 m / 500 m / 1 km /
  2 km, widened by `platoonGuide.searchRadius` (x1.5 / x2 / x3, never past `bubble.maxM` 5 km); quick reads per move, full at rest (350 ms). Map layer `ms-platoon-guide`. Pure engine `PlatoonGuideRead.ts`
  (`node tools/platoon-test/run.mjs`, 99 checks), bundle reader `PlatoonGuideProbe.ts`, figures
  `MS/Data/PlatoonDoctrine.json` (R / E basis). **Side of the LoC / border** (`PlatoonGuideSide.ts`, `side.*`; review
  22 Nov 2026: the bundle holds Indian and IIOJ&K posts, police, cantonments): help, casevac, recorded HLS, supply and relay
  own side only; water, cover, HLS Gr, nearest Rd, PB and OP on the point's side; from admin.geojson `country` areas, near a
  line the boundary line itself, within 100 m of it not known (`node tools/platoon-test/side.mjs` on the real bundle).
  Bearings shown are grid: the sheets' Indian grid (sheets.json `grid`) else UTM (`plGridDeg`, `PlLeg.gridDeg`; spots keep
  true bearings for drawing). Also read (22 Nov 2026): crossings (`crossing.*`: bridge, ford, ferry, boat bridge, aqueduct,
  siphon; on the nearest canal / river first; the crossing nearest each patrol obstacle), the nearest foot track (`route`
  layer types 1 2 3 4 7, `track.*`; legs' `trackPct`) and the sheet's `note_going`; water figures (canal / river width, depth,
  banks; `river_reach` depth, current, wet span; lake, marsh, the `bank` layer) with a wade verdict from MovementDoctrine
  `water.ford`; comms (post office, telephone exchange, wireless station); dams / barrages / headworks as VPs; BUA outlines
  from settlements.geojson (`PlatoonGuideBua.ts`, parsed in `PlatoonGuideBuaWorker.ts`): nearest BUA to its edge, the PB
  test, outlines on the map (`node tools/platoon-test/bua.mjs`). The Movement Guide's Patrol card calls `patrolCard`: keep `PlProbe`,
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
- **MovePlanner** (`Engines/MovePlanner/`) — optional, off by default (`features.movePlanner`; info bar 🚚 Mov Plan / ⚙).
  The old Mov Plan app (`Material/movplan`: Rd Mov, Mov & Assy, DI Mov = de-induction, Rly Mov, En Mov) rebuilt as one
  panel docked at the foot (**U** open / close, **Shift+U** next view, Esc): kinds as tabs, each with its own plan (JSON;
  kept in the browser, Save / Open). Road kinds: serials on routes (solved on the road network when up, else as clicked;
  drawn; a placed line; right-click "Mov Plan: Use as Route…"), TPP = vehs x 60 / flow + 2 min per 25 vehs, halts by
  running time or at 10 to odd hours, close-up halt at last light, harbours when the Day / Ni window closes, crossings and
  shared road resolved by strict priority corps > group > unit > OOM (lower waits until the other clears + 1 min, fed
  forward); views Mov Table, Graph (time-distance bands, night shaded), Matrix / block timings / assy area size, Flow
  (planning table), DI Progress and Reports (arm-wise, priority-wise, HMT). Rail: vehicles onto wagons by the rolling-stock
  table, trains within 72 C units / 2,000 t / 18 double MBFRs, night timetable (placed 45 min after last light, 90 min
  gap), stock required. Enemy: trains by formation type, queues at shared stations, induction matrix. Timeline puts columns
  on the map. Pure engines `MoveTime` / `MoveGeo` / `MoveRoad` / `MoveRail` / `MoveEnemy` / `MoveReports` /
  `MovePlannerModel` (`node tools/moveplan-test/run.mjs`, 70 checks); rules in `MS/Data/MoveDoctrine.json` (R = SO's Hbk Sec 9 /
  Staff Duties Vol II, O = old code, E = proposal). No terrain bundle. See `MS/Docs/19-move-planner.md`.
- **GunDeployment** (`Engines/GunDeployment/`) and **AdminArea** (`Engines/AdminArea/`) — two site finders, each optional and
  off by default (`features.gunDeployment` / `features.adminArea`; top bar 🎯 Gun Depl / 🏕 Admin Area, each with ⚙; Ctrl+K
  widgets; panels docked bottom left / right; built 17 Nov 2026). Pick where to look on the map; the finder lays the area
  (Bty 400 x 200 m / Regt 1000 x 1000 m; Unit Ech, BAA, DAA, RP, Amn / Sup / POL Pt, ADS by doctrine) over a lattice of
  places and ranks them with rows (value, tone, why, fix). Gun: room, level (plane fitted to the 30 m elevation), firm in
  the month, hidden from air, access, range (ORBAT `weapons.json`, planning range 90 %), behind the FDL (2/3 of the range
  forward), crest toward the target (FM 6-50 A1 / A2 from the elevation + what stands on it, A4 estimated, A3 / A5 named:
  need firing tables; the range low-angle fire clears it from), avoid. Admin: beyond the en gun (field / medium / mortar
  from `weapons.json` side en, his gun depth 0 by default), DAA behind the front by op (48 / 15-20 / 33 km), firm, flood /
  drainage (wet month = 100 mm rain, climate grid), room, air, class 50 road and off the main road, avoid, water, pucca
  building, evac road, people. Target / threat default to the Ground Guide's threat marker; the front is the FEBA / FLOT
  drawn on the map. Create on Map: PAA circular `25240502`; 2525D Regimental / Brigade / Division Support Area
  `25310500` / `25310600` / `25310700` (new, `____LabelledAreaBase`, no designation: it sat on the word) or the catalog
  point. Shared `Engines/SiteScan/` (pure `SiteScan.ts`, bundle `SiteProbe.ts` = own MovementGuideProbe + climate + OCOKA
  surface blockers, `SitePanel.ts`, `SiteMap.ts`); figures `MS/Data/GunDoctrine.json` / `AdminDoctrine.json` (R Pakistani
  book + page, U US doctrine, E proposal); `node tools/sitefinder-test/run.mjs` (52 checks). See
  `MS/Docs/20-gun-deployment-admin-area.md`. Every decision is justified with rule, book and page: doctrine figures carry
  `refs` (book, printed page, words; role rule / context) checked against the PDFs by `python tools/doctrine-refs/verify.py`
  (`--write` records `checked`); each check row carries `rules`; `site.why` says why it is chosen / below the one above;
  `rejectedWhy` gives the places left out with their rules; **Why not here?** reads any clicked place with the same scorer
  (`gunWhyNot` / `adminWhyNot`); Copy as Text is a decision record with numbered citations. Never cite a figure without
  its ref or mark it E. Everything that triggers a verdict is backed: a book rule, the data it read (`SiteScan.dataCatalog`:
  bundle layer + sources + dates, never "NCGDB"), the terrain rules (T: rules.json, soil rule, climate wet threshold), the
  user's inputs, or a named threshold in the doctrine JSON (`checks`, `scan`, `order`); none hidden in code. Bases: R / U /
  S (Pakistani book, US doctrine, civil standard: page + words, `calc` when worked out), M (method setting, not a military
  rule; shortcuts proved by tests), E (decision: `decided` + `searched`, shown "Decision, no book figure"). The US manuals
  and civil sources are kept in `Material/Literature/2. Online/` (git-ignored) so verify.py checks them locally (also .txt
  web pages); run.mjs fails if any figure is unbacked, undecided or unchecked.
- **AoiCheck** (`Engines/AoiCheck/`), **CrossSection** (`Engines/CrossSection/`) and **Compare** (`Engines/Compare/`) — three
  terrain tools, each optional and off by default (`features.aoiCheck` / `crossSection` / `compare`; top bar 🗺 AOI Check,
  📈 X-Section, ⚖ Compare, each with ⚙; Ctrl+K widgets; built 17 Nov 2026), on the shared `Engines/SiteScan/`. AOI Check:
  pick an area or this view; fetches every manifest raster layer and each mover's dist layer tile by tile (finest zoom
  within `maxTiles` a layer, coarser said), counts missing / failed tiles and no-data pixels, checks the z10 feature and
  road tiles and the population / climate / visibility grids, and reports the share in the data's frame, the readings
  each gap blanks (Gr class and heights first), movers, build stamps and every source with date and licence (never
  "NCGDB": "1:50k map"); gap tiles painted red / amber. X-Section: a drawn / selected / right-clicked line ("X-Section…")
  read every 30 m by `SiteLine.profileLine` (height, going for the mover in the month, obstacles crossed or along, steep
  from rules.json slope classes, no-data gaps, seen by the threat marker), drawn by `CrossSectionChart.ts` with a hover
  read-out and map marker; the old `RouteProfileEngine` is untouched. Compare: up to four corridors / positions (A-D) under
  one mover, month and threat; rows with their "how", best / worst only past each row's smallest real difference,
  differences in words, "best on" tallies, no overall score (`CompareRead.ts`). Tests `node tools/sitefinder-test/tools.mjs`
  (40). See `MS/Docs/21-aoi-check-xsection-compare.md`.
- **GroundAppreciation** (`Engines/GroundAppreciation/`) — optional, off by default (`features.groundAppreciation`; top bar
  📝 Aprc with ⚙; Ctrl+K widget; built 22 Nov 2026; `Appreciation_Plan.md`, `MS/Docs/22-ground-appreciation.md`). The
  appreciation of the situation as one model (`AprcModel.ts`: parts, groups, numbered paragraphs; outline by kind via
  `registerOutline`: `def` from the AprDf specimen, `attk` from "Mechs of Aprc (Attk)", its paras 1-24, every ruled
  paragraph's prompts citing the book's sheet), drafted on **Read** from the ground (through the Ground Guide only:
  `guide.aorAround()` = the Gr Scope AOR reading on demand, the rail need not be open; sections, cover and the Extended
  View's sight at the MITG and on each approach), the symbols on the map (`planRecordsOf` → `readSymbols`) and the last
  Check my plan (`DeploymentBuilderEngine.planCheck`). Aprc never turns the guide on by itself (it is the user's switch):
  with it off, one click on **Turn on Ground Guide and read** turns it on and reads once the terrain data is in
  (`read({ waitGuide: true })`, up to 2 min; Read also waits while the guide is loading). Once a sheet holds a reading it
  is kept current: changing Defence / Attack reads again (a sheet never read only takes the new headings), H re-times
  the en options (re-reads a defence kept from an earlier session, else says why nothing changed); an attack read notes
  the obj / own start it assumed. `clear()` and `fromJSON()` drop a Read still running. A paragraph is GR / MAP / YOU JUDGE (a proposal) / YOURS (a ruled
  line); what the planner writes is his and is never overwritten (stale-marked when the reading changes); a proposal prints
  in the fair copy only once accepted; "Ref to whites" is never printed; the address block is titles and ruled lines, and
  the marking at head and foot of every page is a ruled line too (no marking text is held).
  Fair and draft copies (draft adds marks, basis, data and Confirm on Gr annexes). Exports: Word (`AprcDocx.ts`, zipped
  with the PowerPoint bundle's JSZip: no new dependency), PDF by print (`AprcHtml.ts`), text, JSON, and Briefing slides
  (`AprcDeck.ts`: full / decision / sand model, Ops room style `DECK_THEME` (user's pick of
  `ground-appreciation-slides-options.html`): dark slides with one frame, points with the para in the notes, the going bar,
  apch alone on its dark trace, lines of def ladder, strength bars, real previews; slides carry `sourceRef` + `sourceHash`,
  an edited slide is kept on a refresh). En options from `guide.ipbApproachesAround(..., { extras: true })` (avenues with his times from H at the book's
  rates, TAIs / DPs into the reactions table, Annex A weather, template phase names); a DP 1 tasks table from the lines of
  def (a Coy per BUA astride an apch: a working assumption, said so); tables typed into in the sheet (`cells`, `addRows`).
  ORBAT (`groundAppreciation.orbatUrl`): relative strength (Coys, all ranks, ATGM, mortars, ratio), own composition, Pls
  held against DP 1; Time Req (move in as a straight-line floor, posn prep IC s75 p 399, minefield p 439); his phases at
  each line of def with clock times from H (`groundAppreciation.hHour`, the sheet's H box); Coy grouping and tasks from
  Check my plan ("from incl X to incl Y"); the appreciation rides in the plan file (`pamsExtras.aprc` via
  `SerializationEngine.registerPlanExtra`). **Attack** (Kind select; `read({ at: obj, from: own start })`): the AOR read
  round the obj from own side (`aorAround` `from` / `away`; its sides mirrored to the attacker's Lt / Rt): apchs onto the obj
  with the book's heads, the obj's ITG heads, his localities on the lines facing the attk; the dir of attk from
  `ipbApproachesAround(start, { readFor: 'attack', objective })` (turning and flanks before frontal, Lt vs Rt weighed, FUP,
  blocking posn at his MSR choke); ratio own to en (3 : 1); Course A, AP-1 and the tasks tables from an attack Check my
  plan; decks by kind (`DECK_IDS`). Review fixes (23 Nov 2026): every draft carries its source (`src`: gr / map / plan / en /
  orbat / time), so a Read that cannot read the ground keeps the earlier reading (`keepUnread`) and an H change re-times
  only the times (`retime`); typed cells keyed by the row's first column (old "r,c" migrated); Cancel while reading, a
  Changed filter with "Before this Read", Undo (Ctrl+Z) for Clear / Give back / Open / kind, a message history (M);
  light times in `groundAppreciation.utcOffsetH` (5, PKT), never the browser's zone; JSON saved without pictures by
  default. Pure writers `AprcWrite.ts`; `node tools/aprc-test/run.mjs` (352 checks). The doctrine books (24 Nov 2026, `AprcBooks.ts`): gun deployment and quick-attack times, a Line of Denial, leading En option and contingencies, desert / mountain prompts, mules and porters, Adm and Log prompts and a casualty estimate from the ORBAT, each with book and page (`Doctrine_Review.md`). A third kind, **Withdrawal** (`wdr`, `outlineWdr`, `writeGroundWdr`, `writeTsWdr`): OoW Vol III's main decisions (pp 6-7) and factors (pp 7-16), what the plan must fix, Annexes P / Q for the sketch; its Limitations box (new posn, denied until, no rearward move before, clear of a line by, delay, by day). In the mountains the attack's climb is read from the 30 m elevation through `sectionsAround` (a typed climb overrides it); the line of denial is drawn on the para 6 trace and the slides, and passed to the guide (`guide.setAorDenial`) so the Gr Scope AOR trace marks it too; turning the Aprc off takes it back.
  **The two Aprc books** (24 Nov 2026; `AprcMechs.ts` pure, `writeMechs` at the end of every Read and on any sheet input):
  Understanding Aprc (Bn study guide, text layer) and Mechs of Aprc (Attk); a pamphlet's figure drives, the guide's beside it
  (user's ruling). The Aim's **Limitations** box (`setLimits`, `doc.limits`: as far fwd as tac feasible, no pen beyond a line,
  def at all costs, attrition, ready / captured by, max destr, at ni, bunkers ...) drafts the aim and lays the def
  (`layoutDef`: FDLs 5-8 km past the border, depth on the line of no pen; Coys up on IBB p 481 with the guide's table beside;
  screens, protective dets, C Pen / Res / Use of Armr DP heads), Course A as the book's paragraph and its analysis under the
  book's heads; a **Vis of En Op** para at the guide's linear model and the reactions table in prep / aslt / C attk phases;
  header **D Day** (date) and **Now** (D-time) for first / last lt, the moon, the time aval day / ni and essential timings
  (`setDDay`, `setNow`); the Time Req's standard list (specimen hours, OoW Vol I p 39 for a Bn's 36 h); the attack's apchs
  tested on the planning parameters (FUP in own area, BUA in Ph 1, MITG in Ph 1, En seen ...), capacity on the IPB widths, the
  Time Calc worked out in the book's 18 rows (reproduces both books' specimens) with the moon shift; an **ANX P: SKETCH** part
  listing the details to be marked against the map; the books' writing rules flagged (`styleNotes`). See
  `MS/Docs/22-ground-appreciation.md` "The two Aprc books".
- **Deployment Mgr Intelligent Deployment tab** (was "Build"; `PlanBuilder_Plan.md`; Phases 0–8 built 15 Nov 2026: geometry, terrain fit, Auto /
  Compare / J) — on by default (`features.planBuilder`; it loads nothing until the tab is opened), `planBuilder.*`.
  J while the plan rests moves the worst posn to better ground (never leaving the plan worse), Shift+J takes it back;
  Check → Compare layouts shows every layout fitted at the same spot (`fitLayout`, `rankFits`, `nextBestSpot`).
  Phase 4: the what-if (`PlanWhatIf.ts`, `node tools/planbuilder-test/whatif.mjs`): routes on foot round NO-GO at the IPB
  rates to the alternates, a Sup posn per secondary approach and a C Pen posn on the main one (planned, dashed), each
  timed against the enemy's lead element, in the trigger table (Check, Copy as Text); his times start no nearer the FDL
  than his FUP (a threat marker inside it is his direction only) and his infantry pay the climb in the mountains (MW p 81);
  an own move no short detour gets round takes the least-cost way on the ground, as his approach does. "Moves in time" is laid
  out (each move with both times, Why, Fix; `Check.detail`) on the card, in the Check step and Copy as Text. Built-plan labels 7 pt
  (`planBuilder.labelSize`). **Enemy and ground** (`PlanContext.ts`, `PlanDoctrine.enemy` / `terrain`): En force Coy / Bn /
  Bde / Div (Auto one up in defence, 3 : 1) sizes the approaches (he attacks on the corridors of the level below, IPB p 7)
  and the force ratio; En type Inf / Mech / Armd sets his going, rates and FUP (IBB pp 201, 214); Ground Auto / Plains /
  Obstacle / Desert / Mountains (Auto read off the bundle where the plan rests) sets frontages (a Bn: normal 3-5 km in the plains, IBB p 277, an extended frontage there warns, IBB S59; extended in the desert and mountains, DW p 24, MW p 148; an obstacle IC s113; a desert attack by day twice the night assault frontage, DW p 47), gaps, flanks,
  foot rates and the layout tried first. Phase 5 **Check my plan** (`PlanCheck.ts`; the tab's Build a plan / Check my
  plan switch): reads the selected symbols, the last placement or all (`SerializationEngine.planRecordsOf`, Mgr
  `readDrawn`), maps roles (label, SIDC, size; planned = D line; outline; front from marker > enemy symbols > arcs /
  minefields / covering troops), runs the same rules check-only; `node tools/planbuilder-test/check.mjs` (86, on the
  12 Bde Def test fixture, Bn Def and Div Attk samples; the 12 Bde Def is off the Templates list, in tools/planbuilder-test/fixtures). The ground shapes a built plan (user's sketch, 15 Nov): a Battle Posn's echelon
  mark sits on its **rear** side (`BP_SHAPE`); posns move a short way up to higher ground and their curves (CTRL_PTS)
  follow it, off NO-GO and water (`fit.highGround`, `fit.outline`); an attack axis bends round NO-GO on foot (CTRL_PTS,
  BASE_LN_PTS width) and the assault's pace along it is timed. **ORBAT wired** (`PlanOrbat.ts`, `planBuilder.orbatUrl`): unit
  type chips (Std / Mtn / MIB / ABIB ... and the FC / Rangers Wings; 3-Coy types not offered on a Bn plan; a Coy or Pl plan
  takes the chosen type's rifle Coy or Pl, `unitForPlan`; a Bde plan the Inf Bde / IIBG / Indep Mech Inf Bde Gp), every own
  arm file read as one list (`mergeOwn`, 358 units) so a child in another arm's file is found, ranges from the unit's weapons, its ATGM pairs sited on
  the tank approaches + AT cover row, a mounted reserve for APC units, force ratio own Coys vs the en unit of Sec 13, the
  minefield in time (engr p 439); `node tools/planbuilder-test/orbat.mjs` (88). **Tanks in a Bn defence** (`PlanTanks.withDefTanks`, `Recipe.defTanks`, Tanks row 0-3 Sqns):
  leaguers beside the reserve (MIB p 68), the Sqns the C Pen force at tank rate (`PlanWhatIf` `tk-cpen-*` triggers), Tank leaguer row, counted in
  the force, read back by Check my plan (`pbMeta.defTanks`); Tps on a Coy Def; the first unit also to the Sup posns; Tank AT cover row with
  the gun at `atFramework.tankGunEffM` 2500 m (basis E: Sec 1, re-read unlocked on 19 Nov, prints a gun range only for the Al-Zarrar; IC s105 para 21c: tanks in defence counter-attack, AT weight only where inescapable) (`tanks.mjs` 86). The tank Sqn with an attack is the ORBAT's (`tankSqnOf`, 14 tanks, `Recipe.tankSqn`;
  counted in the force ratio; gun ranges are printed for 1 of 13 tanks, so the doctrine's stand) and the IABG / Armd Div are Bde / Div
  types. **Artillery** (`PlanArty.ts`, Arty row on Bn Def / Attk): a Regt or Bty from the ORBAT, its gun area (PAA) laid in GunDoctrine's
  band behind the FDL / FUP (`gunRulesFrom`), Arty reach (DF Tgts, his FUP; Obj and LOE) and Gun area on the bundle's `gun` going;
  read back by Check my plan (`pbMeta.arty`); on the crossings too (a Div bridgehead takes a Div Arty, one gun area a Regt,
  `ownDivArties`, `gunArea2`...); **G** while a Bn plan rests sites the gun area with `GunDeploymentFind.findGunAreas` on its own
  `SiteBundle` (Gun site row; `GunDeployment.ts` untouched); `node tools/planbuilder-test/arty.mjs` (41). **AD** (`PlanAD.ts`, AD row:
  an AD Bty / Regt as fire units sited round the VPs (in the desert the reserve first, DW p 63): bridges, gun areas, HQ, Assy, reserve; AD cover; `PlanDoctrine.ad` E; `ad.mjs` 21).
  **Air lift** (`PlanAvn.ts`: the Air Aslt Bn by the Air Aslt Sqn, waves and build-up; `PlanDoctrine.airAslt` E; `avn.mjs` 10).
  **AT on the Obj** (`PlanAttack.atOnObj`: an attack's ATGM pairs, the AT Coys grouped, facing his counter-attack ways in); G sites a crossing's gun areas too; `bn3-cross-two-up` (Lt Cdo).
  **Advance** (`PlanAdvance.ts`, OoW Vol II Fig 2: an Armd Bde advance to contact, echelon rows; on the ground the axis routed for tracks, its crossings and bridge classes, report lines and bounds, halting areas, the march timed by the Move Planner's road engine; RL apart and H set in the tab; Fig 2 read from the page text under the highlights; `advance.mjs` 42).
  Also a **Bn Adv Gd** (`bn-advance-one-up`: vanguard a Coy group, IBB Fig 12 night spacing, main guard 300-400 m back by night, flanks cleared 800 m by day, Bn HQ one bound behind the vanguard, tanks in it, who leads read from the country: IBB pp 133-150, MIB pp 81-84; `advance.bn.*`) and an **Armd Div on a broad front** (`div-advance-two-bde`: two Bdes on two axes, each routed and read, axes 3-8 km apart E: OoW Vol II pp 52-53, DW pp 35, 55; `advance.div.*`; `advanceKind`); halting areas sited on the ground right or left of the axis for cover, firm ground and entry (`siteHaltingAreas`, IBB p 160, OoW Vol II p 12, `advance.haScore` E). Second round of book gaps (24 Nov 2026, `node tools/planbuilder-test/gaps2.mjs`): a second obstacle beyond a bridgehead taken inside the BH line (OoW Vol II p 51, `crossing.secondObstacle`); an RR and its alternative in each forward locality of the Bn defences, row RR (IBB S8 pp 38-42, `atFramework.rr`); the Div Arty in groups behind each forward Bde on a Div defence (OoW Vol I p 83, `divArty`); AD sites on dominating features in the mountains (MW p 247, `adMountainRows`); the desert reserve share (DW p 26, row Reserve share judged in `groundNotes`); Mine gaps on the reserve's routes (OoW Vol I pp 38, 42) and the En quick attack 30-60 / 60-100 min from contact (MIB p 89) in the what-if; Check my plan runs `PlanMountain.layoutRows` on a plan built from a mountain recipe.
  **Inundation** (`PlanEngr.inundation` / `withInundation`, Inundate row on a Bn Def: engr table 20, pp 452-453). Engr Bn Coys
  shared out between Bns (`engrShare`, Engr Coys chips). **Engineers** (`PlanEngr.ts`, Engrs row on
  Bn / Coy Def and the crossings): an ORBAT engineer unit's Pls and MMLs in Mines in time (p 439), its bridging (AVLB, AM-50, ribbon,
  pp 427-432) as Engr bridging, ribbon rafts (pp 430-431) and its TAMs as Mech breach (p 451) on a crossing; **His Mf** on a Bn Attk
  (`withAttackMinefield`, `attackBreach`: Annex Q, the p 450 table, the engineers' Pls / TAMs, begun before H in the H-hour sum);
  `node tools/planbuilder-test/engr.mjs` (49). Fire lifts by the plan's own guns (`liftRings`); 3-Coy Bn Attk layouts (`bn3-attk-*`);
  AT groups by Pl on a Coy Def; the tank Sqn the phase 2 reserve; a Coy Screen by a Recce Sqn (`withRecceScreen`). 3-Coy Bn Def layouts for the Lt Cdo Bn (`bn3-def-two-up`, `bn3-def-three-up`,
  recipe `forCoys`; the tab shows the layouts for the type chosen, `_famIds`) and an **AT group** row on a Bn defence: 1-3 ATGM
  Coys of a LAT / HAT Bn grouped to it (`withAtGroup`, `pbMeta.atGroup`, read back by Check my plan). **Phase 6 attack** (`PlanAttack.ts`): Bn Attk
  right / left flank (BOF fixes the front) beside frontal (warned, ranked last unless no flank is feasible: user); finders
  for the FUP (dead ground), SL (linear feature, clear run, beyond the last lift), BOF (sees the Obj, off the axis), Assy
  Area (hidden, road, outside thermal sights); H-hour sum with fire lifts (IC s66); his MSR choke and weighed Lt vs Rt
  factors (`attack.compareWeights`); Day / Night with the Night March chart.
  **Two phases** (`PlanPhase.ts`, Task step Phases 1 / 2, `attack.phase2.*`): any Bn Attk layout gets Obj 2 behind Obj 1 (on a hostile
  posn drawn there, else his high ground, else 1.5 km behind), the follow-up C, D Coys round Obj 1's flank (not through it) to
  FUP 2 and onto Obj 2's flank (IBB p186), Obj 1 the firm base, the mortars stepped up, H2 timed from Obj 1 falling (Ph 2
  timing, IBB p176 c); **Ph 2 by** chips or **R** while placing: C, D Coys (no Bn reserve: tell Bde) or C Coy with D Coy the
  reserve; **P** while placing: one phase or two; Check my plan reads a later phase (an axis from beside another's Obj);
  `node tools/planbuilder-test/phase2.mjs` (96). His **counter-attack** onto the last Obj (`PlanAttack.counterAttack`,
  `attack.counter.*`, IBB p189): ways in from his depth, dead ground named (LP and DF), a DF target on each, drawn on the map;
  `attack.mjs` (42). Save Plan keeps a built plan's roles (drawEss `PB`, `SerializationEngine.planDocument()`). **Tanks**
  (`PlanTanks.ts`, Task step None / Fire sp / Close sp, **T** while placing, `attack.tanks.*`): FUP (Tks) 2.5-3 km out (IBB p214),
  Close sp on its own axis converging on the Obj timed to the infantry's assault line (p187), Fire sp to fire posns by the BOF
  (p214 option a, night range 800 / 1600 m), who leads from his fields of fire (S35 pp 145-146), tank going on tracks;
  `node tools/planbuilder-test/tanks.mjs` (58).
  **Phase 8 ambush, patrol, recce** (`PlanSmallOps.ts`, figures `PlanDoctrine.smallOps`, recipes `pl-ambush-*`, `pl-patrol`,
  `pl-recce-*`; recipe `pivot`, `SMALL_TASKS`): wrapped over the Movement / Platoon Guide engines, their card APIs unchanged.
  Ambush: click the KZ on the road, aim up it toward him; the road read toward him (`roadAround` + `RouteScanner`), the spot
  scored and laid line / L / V (`MovementGuidePlans.ambushSiteAt`, the body of `ambushSites` for any station), better sites as
  blue rings; Target chips / **M** while placing. Patrol: click the SP, the second click is the Obj (the Mgr hands the aim
  point to `onGhost` / `prepareCommit`); `planPatrol` + `patrolCard` on routes straightened to night legs; FRV, bounds, the
  route card (legs pulled onto night features, `snapLegEnds`; bearings grid, mils, magnetic with `planBuilder.gmaDeg`).
  Recce: SP, then the NAI; OPs picked for what each adds to the view, routes in dead ground. **J** on an ambush takes the
  KZ to the better site (Mgr `moveAnchor`), Shift+J back. **Coy Screen** (`coy-screen`, IC s73 pp 378-381: click the Wdr RV,
  aim at the ground in front; posts on the ground that sees the main posn, no further forward than needed, laterally with
  intervals, covered ways back, 2525D Screen) and **Pl Area Ambush** (`pl-ambush-area`, IC s44 p 152: central site plus an
  outlying Sec ambush each way along the road). Check my plan reads a built ambush, patrol, recce, screen or crossing as
  drawn with the build's rows (`checkSmallOp`, `checkCrossing`). `node tools/planbuilder-test/smallops.mjs` (107).
  **Phase 7 crossing and bridgehead** (`PlanCrossing.ts`, figures `PlanDoctrine.crossing` from IBB S46-47 pp 231-246 and
  Annex Q pp 467-468, IC s70-71 pp 355-366; recipes `bn-cross-two-up`, `bde-cross-two-up` / `-four-bn`,
  `div-bridgehead-two-bde`): click H on the water, aim at the far bank; over the Movement Guide's Water engine (readWater /
  readReach, unchanged) the plan is re-laid along the obstacle (`ObstacleFrame`: x along it, y across from the bund), the
  bridge site moved to the narrowest, firmest place within 400 m, far-side ground that sees the crossing places found and
  the BH line reaching out for it (to 1.8 km, 2.5 km with four Bns, 6 km Div), boats / rafts / bridge / tanks timed from
  Annex Q by Light (Day / Moonlight / Dark night chips), the drift entry 2 x the width upstream. 2525D Assault Crossing
  `25271300` and Bridge `25271400` added to Symbols.json on the Bridge class; crossing places slide 150 m to better spots;
  the Mf chip adds his minefield 900-1000 m out with Breach lanes timed from Annex Q (`withMinefield`, `breachRow`). The
  mirror, **canal defence** (`bn-def-canal`, IC s85 pp 449-458, IBB S60-62 pp 328-339, Annex V p 483): laid along the canal (`canalPrep`),
  rows Canal / Higher bank / Bridges in sector / Marsh / Obstacle value. `node tools/planbuilder-test/crossing.mjs` (58).
  **Included 23-24 Nov 2026** (`PlanBuilder_Plan.md` "Included and enhanced"): every PlanDoctrine figure backed (D / R / calc
  refs checked by `verify.py`, E decided + searched, M settings; `recipes.mjs` fails on any unbacked one); **reverse slope**
  (`bn-def-rev-slope` / `coy-def-rev-slope`, `PlanRevSlope.ts`: crest on the 30 m elevation, FDL behind it within MG range,
  OPs / FPF on the crest, Fields of fire FDL to crest; IC s78 pp 429-431, IBB s69 pp 357-359; `revslope.mjs`); **withdrawal
  by night** (`bn-wdr-night`, `PlanWithdrawal.ts`: old HQ, aim back, new main posn; rear parties, RVs, EPs, routes back,
  intermediate posn beyond En field artillery and behind an obstacle (class grid + mapped canals / rivers), programme from
  last light; Check my plan `checkWithdrawal`; `withdrawal.mjs`); Coy Attk, Bde Def, Div Def, Bde Attk recipes; **three
  phases** (`threePhaseRecipe`, P cycles 1-2-3) and an Obj 2 the user marks; the tank Sqn's Assy area (MIB p 118; was "harbour") and its move; FUP (Tks)
  against the En ATGM range from the ORBAT; Corps bridging when the span passes the division's 84 m; the patrol's Night
  March chart. Plan Builder texts say En / Own, never his / he.
  **Frontages by ground, cited (24 Nov 2026)**: own rows only (the Foxland rows of IC s113 / s114 and IDD are the En's):
  an obstacle Bn IBB Annex V 2750-4115 m (pp 483-485), a mountain Bn IBB's extended rows (MW prints no figure), a Coy 1200-1500
  m (AMP p 1.10), a Pl post 300 m (IBB Annex U App 7) with AMP p 1.3's 500 m most; the assault row by echelon
  (`attack.assaultRowByEch`: Coy 250 m, Bn two up 450-650 m, IBB S47 para 17 a p 248; Bde GSP p 86, desert p 87) judged by
  day and by night on every ground (`assaultFrontageCheck`: desert twice by day, DW p 47; mountains narrower, MW p 79; plains
  wider by day with no figure, OOW2 s9 p 36: warns, never fails); a Bde / Div beyond its row on extended ground warns
  (`frontageRowCheck`). No figure rests on the IBB p 277 margin tables ("Source: ARIB", a reader's note): check.mjs guards it. **Doctrine gaps (24 Nov 2026,** `Doctrine_Review.md`; `node tools/planbuilder-test/gaps.mjs`): `div-def-three-axes` (OOW1 Annex D), a Bn HQ in every Bn defence (IBB p 23), an AT Res in Bde / Div defences (OOW1 p 45), `groundNotes` (the mountain / desert / night / attack rules of MW, DW, MIB, IBB, OOW2 appended to rows, run last in the build, the fit and Check my plan), the mountain breach without lanes (MW pp 86, 106, 113), Mortars whole or split (IBB pp 54, 61), Coy RVs 200-500 yd (IBB p 381), crossing twin obstacle / regulated water / APC swim (IDD p 8, MIB pp 278-280). **Plan types (24 Nov 2026,** `Doctrine_Review.md`; `node tools/planbuilder-test/plantypes.mjs`, 78): `bn-delay` (`PlanDelay.ts`: DP 1-3 a 4.2 km hop apart, MIB pp 233-239, OOW3 p 29), `bn-wdr-day` (leap-frog through the depth, MIB pp 223-224, OOW3 pp 40-43), `bde-wdr-night` / `div-wdr-night` (`PlanWithdrawalFmn.ts`, OOW3 Annex P: two int posns, covering tps, flank guard, axes, Dml belt), mountain Bn Def ridge / penetrant / lateral / pass / valley and Bn Attk (Mtn) (`PlanMountain.ts`, MW pp 78-162), Bn Attk / Def (BUA) and the MIB Gp fixing force (`PlanBua.ts`, IBB S49 / S58, MIB s23 + Annex P); their rows through `PlanMountain.layoutRows` (build, fit, Check my plan). Withdrawal checks (`withdrawal.mjs`, 37): int posn view and flanks, rear parties per approach (MG 457 m, OOW3 p 27), Coy check pts, BL, passage lanes through the int posn (OOW3 Annex Q, pp 19, 48, 67).
  Review fixes (23 Nov 2026), checked by `node tools/planbuilder-fixes/run.mjs` (18): the ground's kind needs class data
  (elevation alone is never "plains"); no approach found is grey, never a Pass; Check my plan faces each posn by its drawn
  open face and times the drawn Sup / C Pen posns; the alternate's move one way (foot rate x under-fire factor + settle);
  fit thresholds read `fit.*` doctrine paths. The Mgr: keep placing re-fits each copy, Esc restores the Templates
  options and says nothing was placed, a key notice says why a key does nothing, one threat (the tab's marker, else the
  Ground Guide's via the host's `threat`, else the enemy symbols with `threat.fromEnemySymbols`), an Options fold.
  Templates (was Samples) / Intelligent Deployment tabs in the Deployment Mgr; Intelligent Deployment = Task →
  Enemy → Place → Check → Create. Doctrinal baseline plans (Bn / Coy Def two up, three up, one up, all round; Bn Attk
  frontal) from recipes (`MS/Data/Deployments/Recipes/`: slots with a geometry `seed` or `shape`, `rule` and
  `terrainRule`), figures in `MS/Data/PlanDoctrine.json` (frontages stay in `OcokaDoctrine.json`). Pure validator
  `PlanRecipes.ts` and solver `PlanSolve.ts` in `MS/Engines/DeploymentBuilder/` (`node tools/planbuilder-test/recipes.mjs`,
  `solve.mjs`); the tab (`PlanBuildTab.ts`, loaded only while on) hands a Plan document to the Mgr's own placement (ghost,
  aim, one undo step); graphics carry `pbRole` / `pbRecipe` / `pbPlanId`. Without the terrain every ground check is grey,
  never Pass. Terrain fit (`planBuilder.useTerrain`, pure `PlanFit.ts`; bundle reader `PlanGroundProbe.ts` = an own
  MovementGuideProbe + `findAvenue`; `node tools/planbuilder-test/fit.mjs`): quick ghost while the mouse moves, after
  `fit.restMs` at rest the fitted ghost (posns slid out of NO-GO; Auto = best layout), tank approaches from the threat
  marker in red, a verdict marker per posn (the card's icon on a dark disc, a tag naming the posn and its worst check outside its outline, the latest late move marked on its route: the user's pick M2) and the plan's card **docked full width at the map's foot** (user, 24 Nov 2026: at the cursor it hid the map and the plan; `_showCard` / `_dockCard`, like the Platoon Guide's bar, over the host's panels there, at most 40 % of the map, ▾ folds the ledger away; the Mgr's floating placing bar is hidden while it is up (`body.pb-docked`) and its step leads the dock's key row): the user's pick C "Ledger" of `plan-builder-card-options.html` (the fit score, every fail and warn as a row worst first with the first laid-out one open, a race for late moves, Why and Fix, passes counted, key caps; GroundGuideTokens sizes) beside the **Ground** (Auto shows what the terrain reads where the plan rests and why, `FittedLayout.detected`; a kind set by hand is flagged when the terrain reads otherwise) and **every layout's fit score** with its fail / warn count (Auto, the default, lit; Auto's pick marked beside one chosen by hand), all chips that work while the plan is armed, as do **E** (ground, Shift+E back) and **N** (layout, Shift+N back); moving the pointer onto the dock puts the plan back where it rested (Mgr `ghostSpot` / `restoreGhost`); the click fits again and places the fitted plan; a
  marked threat makes the plan face it and one click place it (`PlanEntry.faceAt`, Mgr `setPlacementHooks`). Coy =
  doctrine 1500 × 600–800 m. Symbols made as in 2525D: FEBA (FDL) `25140400`, LOA (LOE) `25140900`, FPF `25240703`,
  PAA (gun area) `25240501` / `25240502`; Security Zone local `00000161` (2525D has none); lettering is geometry (`MS/Support/StrokeFont.ts`).
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

The harness is `src/mapBoot.ts` + `src/main.ts` + `index.html`, which:

- Create 2D/3D views (`mapBoot.ts`, run by index.html before `main.ts` so the globe starts loading while MS/ is
  still fetched; it imports only `@arcgis/core` and JSON, never MS/ code) and instantiate `SymbolEngine`
  (`main.ts`, `window.symbolEngine`). Map service overlays join the map only once their service answers
  (`addWhenLoaded`): a layer still loading holds the view back (an unreachable server cost 21 s at startup).
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
8. **Geometry operations go through `MS/Support/GeometryOps.ts`** (buffer, union, intersect, geodesic
   length / area / densify, nearest coordinate, ...): it wraps the ArcGIS `geometry/operators/*` modules
   with the old `geometryEngine` call shapes, loads the geodetic operators (SymbolEngine starts it) and
   answers from a Vincenty / cos-latitude fallback until they are ready. Never import the deprecated
   `geometry/geometryEngine` or `geometry/support/geodesicUtils`.
9. Never `btoa()` SVG that can carry label text (throws on non-Latin-1, e.g. Urdu) —
   use `Utils.svgToDataUrl()`. User-supplied text interpolated into `innerHTML`
   goes through `Utils.escapeHtml()`.
10. **Off-by-default engines load lazily** (`LAZY_ENGINES` in `SymbolEngine.ts`: Ground / Movement / Platoon Guide,
   Night March, Move Planner, Gun Deployment, Admin Area, AOI Check, X-Section, Compare, Aprc): SymbolEngine imports
   them with `import type` only and fetches the code when the feature is turned on, so a host that leaves them off
   never loads them. Their getters are null until created; code that turns one on and uses it at once waits:
   `se.toggleNightMarch(true); (await se.whenReady('nightMarch')).startDraw()`. A new optional engine goes in
   `LAZY_ENGINES` the same way (its `_initX` takes the class from `_lazyClass`); never import it statically.
