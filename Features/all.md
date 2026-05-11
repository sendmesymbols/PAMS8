# PAMS8 — Comprehensive Feature List

All features deconflicted and merged from planning sessions.  
Engine tags show where each feature lives or will live.  
Duplicates across sources have been collapsed into single entries.

---

## A · Plan System
> PlanEngine (new module) — each plan type configures symbol vocabulary, auto-activates overlays, and presets measurement modes.

| # | Feature | Engines |
|---|---------|---------|
| A1 | **Defence plan template** — pre-loads FEBA/FLOT lines, defensive positions, obstacle belts, reserve positions, engagement areas; auto-activates area-denial and minefield overlays | PlanEngine |
| A2 | **Attack plan template** — scaffolds LD/LC, axis of advance, phase lines, objectives, assault positions; MeasurementEngine auto-computes SP→phase-line distances and march-time estimates | PlanEngine · MeasurementEngine |
| A3 | **Logistic plan template** — loads MSR/ASR routes, logistic bases, supply points, ammo holding areas; triggers corridor-buffer overlays and march-time estimates on every supply route drawn | PlanEngine · DrawingCueEngine · MeasurementEngine |
| A4 | **Engineers plan template** — pre-populates breach points, bridging sites, obstacle overlays, route-classification lines; activates slope/gradient cues for terrain impact while drawing | PlanEngine · DrawingCueEngine |
| A5 | **Communication plan template** — scaffolds radio relay stations, antenna sites, comms zones, HF/VHF coverage arcs; LOS analysis runs automatically from each comm node on placement | PlanEngine · TerrainEngine |
| A6 | **Plan switcher with overlay merge** — multiple plan types open simultaneously as named overlays; merge view renders all active plans with per-plan opacity control and colour-tinting by plan type | PlanEngine · UI |
| A7 | **Plan-type SIDC filter** — restricts the visible symbol picker to symbols relevant to the active plan type; logistic plans hide direct-fire weapon symbols | PlanEngine · SymbolEngine |
| A8 | **Rapid symbol palette by plan type** — when a plan type is activated, the palette reorganises to show that plan's most-used symbols first (e.g. defensive positions and obstacle types for a defence plan) | PlanEngine · SymbolEngine |
| A9 | **Per-plan-type label colour** — each plan type (defence, attack, logistic, engineer, comms) has its own label colour scheme applied by AnnotationEngine | PlanEngine · AnnotationEngine |

---

## B · Exercise Scenarios
> ScenarioEngine (new module) — seeds the map with a starting condition, defines success criteria, emits score events.

| # | Feature | Engines |
|---|---------|---------|
| B1 | **Logistic test scenario** — auto-places convoy start, waypoints, and destination with pre-set echelons; MeasurementEngine computes leg times; CollisionEngine checks route against simulated threat positions | ScenarioEngine · MeasurementEngine · CollisionEngine |
| B2 | **Ambush exercise scenario** — spawns kill zone polygon, blocking positions, and withdrawal routes; DrawingCueEngine highlights sector-of-fire arcs from each ambush position; friendly-force path drawn through kill zone | ScenarioEngine · DrawingCueEngine |
| B3 | **Route planning test** — presents start/end points with terrain-constraint layer active; planner must avoid red-zone terrain, pass through checkpoints, meet a time window; MeasurementEngine scores the route live | ScenarioEngine · MeasurementEngine · DrawingCueEngine |
| B4 | **Scenario playback / after-action replay** — records all drawing events with timestamps and replays as animated sequence; supports step-forward, step-back, scrub bar; doubles as after-action review layer for training debrief | ScenarioEngine · Replay module |
| B5 | **Scenario scoring / assessment** — each exercise defines success criteria (route length threshold, no red-zone crossings, time limit); ScenarioEngine emits a score event on completion, driving a results panel | ScenarioEngine |

---

## C · Terrain Analysis
> TerrainEngine (new) wrapping ArcGIS ElevationLayer + geometryEngine + viewshed.

| # | Feature | Engines |
|---|---------|---------|
| C1 | **Live elevation profile** — as a polyline grows, ElevationLayer.queryElevation() is called per segment; a floating SVG sparkline beside the rubber-band label shows cumulative rise/fall, gain, loss, and slope % in real time | DrawingCueEngine · MeasurementEngine |
| C2 | **Slope / gradient colour cue** — computes rise-over-run per segment and colours the rubber-band line: green (<8%), amber (8–15%), red (>15%); critical in 3D terrain mode where visual angle is deceptive | DrawingCueEngine |
| C3 | **Line-of-sight (LOS) cone** — from the last confirmed control point, runs a live LOS query toward the cursor; renders a green/red shaded arc showing visible vs. occluded sectors; shows "Intervisible" / "Masked" label without leaving the draw workflow | DrawingCueEngine · TerrainEngine |
| C4 | **Terrain passability overlay** — queries a slope-class raster on draw start; renders semi-transparent passability layer: green = wheeled OK, amber = tracked only, red = impassable; updates as map extent changes | TerrainEngine |
| C5 | **Terrain following (3D)** — in scene view, auto-adjusts symbol elevation to the ground surface with an optional user-set offset; keeps symbols properly grounded during placement | Symbol rendering pipeline |
| C6 | **Flood / obscuration risk highlight** — highlights low-lying areas or dead ground behind ridges with a semi-transparent raster or dynamic graphic overlay; useful for defensive planning | TerrainEngine |
| C7 | **Slant-range (3D) distance** — replaces 2D geodesicLength with a 3D calculation incorporating delta-Z from ElevationLayer; ridge-crossing routes show realistic travel distance, not just horizontal footprint | MeasurementEngine |

---

## D · Collision & Safety Engine
> CollisionEngine (new) — doctrine-aware conflict detection, exclusion zones, phase-line enforcement.

| # | Feature | Engines |
|---|---------|---------|
| D1 | **Doctrine-based safe distances** — configurable minimum separation per SIDC category (e.g. infantry 500 m, armour 1.5 km, artillery 4 km); pulsing amber ring + warning toast when violated | CollisionEngine · ProximityEngine |
| D2 | **Real-time friendly-fire separation warning** — compares new symbol position against all blue-force graphics live; emits pulsing amber ring and warning toast if within doctrine minimum separation | CollisionEngine |
| D3 | **Symbol overlap / collision check** — on each onDrawProgress, tests in-progress geometry against existing graphics via geometryEngine.intersects(); flashes red halo on colliding graphic and emits collision-warning event to HUD | CollisionEngine |
| D4 | **No-go zone enforcement** — maintains a restricted-area polygon layer; when drawn geometry crosses one, overlays red hatched fill and emits no-go-zone-violation event; optional hard-block of draw cursor inside zone | CollisionEngine |
| D5 | **Exclusion zone snapping** — cursor automatically deflects away from user-defined danger areas (minefields, friendly positions) so the planner cannot accidentally place symbols inside them | CollisionEngine · ProximityEngine |
| D6 | **Phase line / boundary check** — warns when a unit symbol is placed on the wrong side of an active phase line or boundary; derives expected side from the SIDC affiliation field | CollisionEngine · SymbolEngine |
| D7 | **Formation integrity check** — warns when selected units are too spread out or too bunched relative to doctrine frontage/depth rules for the formation type | CollisionEngine |
| D8 | **Doctrinal rule engine** — flags violations of spacing, frontage, depth, and command-relationship rules; configurable per echelon and unit type | CollisionEngine · New module |

---

## E · Drawing Cues & Smart Assistance
> Extends DrawingCueEngine with terrain hooks, predictive snapping, and visual intelligence.

| # | Feature | Engines |
|---|---------|---------|
| E1 | **MGRS grid snap** — on pointermove, snaps control points to the nearest MGRS grid cell boundary at current map scale; eliminates the need for a separate snapping toolbar and ensures grid-aligned planning | DrawingCueEngine |
| E2 | **Predictive terrain snapping** — snaps to terrain features (ridge lines, roads, rivers via feature layers), formation anchors, and existing unit centres | DrawingCueEngine |
| E3 | **Orthogonal / 45° military grid snapping** — hold modifier key to constrain bearing to 0°/45°/90° increments; standard in military map-marking tools | DrawingCueEngine |
| E4 | **Sector-of-fire arc** — when the active symbol is a weapon system, renders a fan arc from the last confirmed point; arc half-angle comes from a per-SIDC config table and rotates live with the cursor | DrawingCueEngine |
| E5 | **Weapon danger rings** — when active SIDC identifies a weapon system, replaces generic distance rings with doctrine-defined radii: minimum safe distance, fragmentation radius, blast radius from per-SIDC lookup | DrawingCueEngine |
| E6 | **Corridor / buffer band** — geometryEngine.geodesicBuffer() runs on the live polyline and renders a shaded lateral clearance corridor; width is user-configurable per symbol type | DrawingCueEngine · MeasurementEngine |
| E7 | **Threat-radius colour zones** — extends nearbyHighlight with filled concentric zones (red / amber / green) so risk reads instantly from colour without counting rings | DrawingCueEngine |
| E8 | **Elevation sparkline on rubber-band** — 40×16 px inline SVG mini-chart appended to the rubber-band label showing cumulative elevation change (rise and fall) along the drawn path | DrawingCueEngine |
| E9 | **Bearing compass rose** — small compass rose near cursor showing current bearing to the last control point; pointer rotates in real time for cardinal-direction sanity check while drawing | DrawingCueEngine |
| E10 | **Symbol preview ghost** — before committing the first control point, renders a semi-transparent preview of the SIDC symbol at cursor; planner sees exactly what will be placed before clicking | DrawingCueEngine · SymbolEngine |
| E11 | **Auto-shape completion** — double-click + Shift auto-closes a rectangle, circle, or regular polygon; "Draw as Formation" tool accepts template + click-center + direction | DrawingCueEngine |
| E12 | **Cursor modes** — keyboard-toggled modes: Freehand, Snap-to-grid, Terrain-follow, Formation mode; visual indicator shows active mode | DrawingCueEngine |

---

## F · Measurement Engine Enhancements
> Extends the existing MeasurementEngine.

| # | Feature | Engines |
|---|---------|---------|
| F1 | **Grid / magnetic / true azimuth** — extends _bearing() with magneticDeclination from IGRF model or user input; emits gridAzimuth, magneticAzimuth, and trueAzimuth on measurement-update | MeasurementEngine |
| F2 | **Military angular units (mils)** — adds NATO mils alongside degrees for all bearing outputs; user-selectable in the HUD | MeasurementEngine |
| F3 | **March-time estimator** — speedKmh option appends ETA to the total-length label ("14.2 km · 2h 50m @ 5 km/h"); updates live as polyline grows; supports wheeled, tracked, and foot-march presets | MeasurementEngine |
| F4 | **Fuel / logistic consumption** — multiplies route length by a user-set fuel-consumption rate and displays estimated fuel requirement alongside march time; feeds into logistic plan template | MeasurementEngine · LogisticEngine |
| F5 | **Artillery range fan measurement** — when an artillery SIDC is active, switches to range-fan mode; displays minimum/maximum range arcs and dead-zone cone, updating live as the symbol is moved | MeasurementEngine · SymbolEngine |
| F6 | **Cross-country mobility rating** — combines slope data with user-supplied soil-type layer to output go/no-go/slow-go per route segment; displayed as colour-banded line over the drawn path | MeasurementEngine · TerrainEngine |
| F7 | **Cumulative statistics panel** — persistent floating panel while drawing multi-segment routes: shows segment length, total length, bearing, elevation delta, slope %, march time, and fuel estimate in one compact view | MeasurementEngine · HUD |

---

## G · HUD & Live Overlay
> Floating overlay components subscribing to measurement and drawing-cue events.

| # | Feature | Engines |
|---|---------|---------|
| G1 | **Live stat panel** — subscribes to measurement-update and drawing-cue-state-change; shows segment length, total length, bearing, elevation delta, march time in one compact panel; appears only while drawing | HUD component |
| G2 | **Contextual warning toasts** — badge-style alerts for terrain steepness, no-go zone crossings, collision, LOS occlusion, and friendly-fire proximity; each badge auto-dismisses when the condition clears | HUD component |
| G3 | **Live unit / mode toggle** — switch between m / km / nm, geodesic / planar, and 2D / 3D measurement mode without stopping the draw session; calls MeasurementEngine.setOptions() live | HUD component · MeasurementEngine |
| G4 | **Minimap inset** — small north-up overview map inset showing the full extent of the current plan with the symbol-in-progress highlighted; maintains situational awareness when zoomed in | HUD component · ArcGIS Inset view |

---

## H · Smart Visualisation & Map Intelligence
> Zoom-reactive display logic in SymbolEngine and LayerManager.

| # | Feature | Engines |
|---|---------|---------|
| H1 | **Zoom-level symbol scaling** — uses the existing reactiveUtils watcher in SymbolEngine; at brigade scale renders only brigade/battalion icons; at company scale reveals company/platoon symbols; milsymbol size scales proportionally | SymbolEngine · reactiveUtils |
| H2 | **Echelon layer groups** — separate GraphicsLayers per echelon (brigade, battalion, company, platoon); layer-visibility toggle panel lets planner isolate one echelon instantly without deleting symbols | SymbolEngine · LayerManager |
| H3 | **Symbol clustering (heat tiles)** — when symbol density exceeds a threshold per screen tile, replaces individual symbols with a count badge and convex hull overlay; expanding a cluster reveals constituent symbols | SymbolEngine · Cluster module |
| H4 | **Symbol opacity by role** — dims inactive/reference symbols (grey, 40% opacity) while the active plan's symbols remain fully opaque; reduces visual noise without hiding context; pairs with per-plan tinting | SymbolEngine · UI |

---

## I · Annotation & Label Intelligence
> Extends AnnotationEngine with declutter, zoom-adaptive density, and plan-aware styling.

| # | Feature | Engines |
|---|---------|---------|
| I1 | **Force-directed label placement** — after each annotate() call, detects bounding-box overlaps and runs a spring-force iterative nudge to spread labels apart; maintains a thin leader line to each symbol | AnnotationEngine |
| I2 | **Adaptive label density by zoom** — at low zoom: SIDC icon only; at medium zoom: UNIQUE_DESIG only; at high zoom: full amplifier set (DTG, staff comments, additional info); thresholds configurable per plan type | AnnotationEngine · SymbolEngine |
| I3 | **Auto callout boxes** — when a label still overlaps after nudging, automatically converts it to an ArcGIS callout TextSymbol with a thin leader line; callout style respects the current plan-type colour scheme | AnnotationEngine |
| I4 | **Echelon-aware label priority** — higher echelons (brigade, battalion) always win label real estate over lower ones (company, platoon) during the declutter pass; preserves the command picture when zoomed out | AnnotationEngine · SymbolEngine |

---

## J · SymbolEngine — Workflow & Productivity
> Reduces click count per symbol and adds command-relationship awareness.

| # | Feature | Engines |
|---|---------|---------|
| J1 | **Symbol stamping (repeat draw mode)** — toggle keeps the same symbol active after each placement so the planner can stamp multiple instances rapidly without re-selecting; standard in CAD tools | SymbolEngine |
| J2 | **Multi-symbol copy with relative offset** — extends the existing clipboard to paste a group of symbols with their relative positions preserved; essential for repeating platoon defensive positions along a line | SymbolEngine |
| J3 | **Symbol linking (parent–child)** — links a subordinate symbol to its parent with a thin command-wire graphic; moving the parent drags all linked children proportionally; represents command relationships visually | SymbolEngine · New module |

---

## K · Selection & Editing Superpowers
> Extends SelectionEngine and EditEngine.

| # | Feature | Engines |
|---|---------|---------|
| K1 | **Polygon lasso + freehand lasso** — adds polygon lasso and freehand lasso to the existing box and rubber-band selection modes | SelectionEngine |
| K2 | **Select Similar** — selects all graphics matching the same SIDC, echelon, affiliation, or any user-chosen attribute field | SelectionEngine |
| K3 | **Formation-aware selection** — selecting a HQ unit optionally selects all its linked subordinates; respects parent–child symbol links from J3 | SelectionEngine · SymbolEngine |
| K4 | **Mass scale / rotate with anchor** — scale or rotate the entire selected group around a user-defined anchor point (e.g. rotate a task force around its HQ) | EditEngine |
| K5 | **Align to terrain** — snaps all selected control points to ground elevation; useful after importing 2D data into a 3D scene | EditEngine · TerrainEngine |
| K6 | **Copy formation** — select a group, paste at a new location with configurable offset and optional rotation; maintains all relative positions | EditEngine · SymbolEngine |

---

## L · UI/UX & Visual Polish

| # | Feature | Notes |
|---|---------|-------|
| L1 | **Rich symbol palette** — large searchable library with preview thumbnails, NATO hierarchy tree, doctrine templates; supports drag-and-drop onto map with ghost preview | SymbolEngine · UI |
| L2 | **Recent / favourites / doctrine templates** — per-user persisted lists of recently used and starred symbols; plan-type-specific preset template sets | SymbolEngine · Storage |
| L3 | **Floating drawing assistant panel** — collapsible persistent panel showing contextual hints, keyboard shortcuts, and progressive disclosure from basic to advanced options | UI |
| L4 | **MGRS grid overlay toggle** — renders MGRS 100 km / 10 km / 1 km grid lines at appropriate zoom levels with zone labels | UI · map layer |
| L5 | **Dynamic contour / hillshade intensification** — contour lines and hillshade opacity increase during active drawing sessions to surface terrain context exactly when it is needed | UI · ElevationLayer |
| L6 | **Dark / light military themes** — switchable colour scheme; dark default for operational use, light for printed map export | UI |
| L7 | **Keyboard-first workflow** — M = Move/Scale/Rotate, E = Edit control points, L = Lasso select, F = Finish drawing, Esc = Cancel, Del = Delete, I = Info, C = Centre, Ctrl+Z/Y = Undo/Redo, Ctrl+C/V = Copy/Paste, Shift+Click = Toggle selection | ShortcutEngine |

---

## M · Advanced / Future Features

| # | Feature | Notes |
|---|---------|-------|
| M1 | **AI planning assistant** — suggests best defensive positions, mobility corridors, and formation placements based on terrain analysis and doctrine rules | New AI module |
| M2 | **Simulation mode** — animates unit movements with a time slider; units follow drawn routes at configured march rates; supports pause, fast-forward, and step | SimulationEngine |
| M3 | **Multi-user real-time collaboration** — concurrent editing with conflict resolution via ArcGIS feature service sync or custom WebSocket layer | Sync module |
| M4 | **Formation templates / auto-arrange** — select a formation type (line, column, wedge, echelon) and click a centre point + direction; SymbolEngine places all subordinate elements at doctrinally correct spacings | SymbolEngine · PlanEngine |

---

## Implementation Priority

| Phase | Features | Rationale |
|-------|----------|-----------|
| **1 — High impact, medium effort** | C1–C3, D1–D3, E1–E2, F1–F3 | Terrain + safety are the biggest gaps vs. a blank canvas; hooks already exist in SymbolEngine |
| **2 — Workflow multipliers** | A1–A6, B1–B3, E10–E12, J1–J3, K1–K6 | Plan templates and productivity tools cut click count for every planning session |
| **3 — Visual & annotation polish** | H1–H4, I1–I4, G1–G4, L1–L7 | Important for readability at scale; depends on Phase 1 data |
| **4 — Advanced** | B4–B5, M1–M4 | High value but significant standalone scope |


before improvement