# Mission Planner Key Terrain Dashboard Plan

## Summary
Build `MissionPlannerEngine` as a unified tactical terrain dashboard, not another isolated analysis widget. It orchestrates the existing `LocalPeaksEngine`, `KeyTerrainIdentificationEngine`, `DeadGroundMapper`, `PosDefScorerEngine`, `OpRankerEngine`, and `OcokaEngine` to answer commander-level questions: best defensive positions, concealed approaches, observation dominance, overwatch placement, and anti-armor positions.

## Key Changes
- Implement `MS/Engines/MissionPlanner/MissionPlannerEngine.ts` as the top-level dashboard engine with `initialize(view)`, `open(graphic?, view?)`, `openWidget(view?)`, `close()`, `destroy()`, `onViewChanged(view)`, `runAnalysis()`, `clearResults()`, and `generateReport()`.
- Add `analysis.missionPlanner: true` and `analysis.ocoka: true` to `MS/Data/Settings.json`.
- Wire `MissionPlannerEngine` into `SymbolEngine`, `ContextMenuManager`, `index.html`, and `src/main.ts` the same way the standalone analysis engines are exposed.
- Add a `Mission Planner Dashboard` entry to `More Actions...` under `Analysis / Mission Planning`.

## Engine Integration
- Existing analysis engines remain the source of truth. Mission Planner calls public adapter methods instead of duplicating terrain algorithms.
- Public adapters:
  - `LocalPeaksEngine.runHeadless(options): Promise<LocalPeakResult[]>`
  - `KeyTerrainIdentificationEngine.runHeadless(options): Promise<KeyTerrainFeature[]>`
  - `DeadGroundMapper.runHeadless(options): Promise<DeadGroundSummary>`
  - `PosDefScorerEngine.scorePoint(point, options): Promise<DefensibilitySummary>`
  - `OpRankerEngine.rankCandidates(points, options): Promise<OpRankSummary>`
  - `OcokaEngine.runHeadless(options): Promise<OcokaCorridor[]>`
- Standalone widgets continue to own their UI rendering and still open independently.

## Dashboard UX
- Tactical dashboard layout with Mission, Terrain, Observation, Mobility, Results, and Report tabs.
- Mission modes:
  - Defensive: dominant ground, defensibility, dead ground behind position, and fields of fire.
  - Offensive: concealed approach, masking, enemy observation gaps, and assault support positions.
  - Recon: observation coverage, OP survivability, and route concealment.
  - Route Planning: mobility corridors, dead-ground avoidance or exploitation, and chokepoints.
- Unit filters:
  - Infantry: max slope 35 degrees, concealment-weighted.
  - Mechanized: max slope 20 degrees, corridor and trafficability-weighted.
  - Aviation: slope-light, LOS and standoff-weighted.
- Observer manager stores friendly and enemy observer points in memory and supports active toggles for what-if reruns.

## Scoring Model
- Produce normalized `MissionTerrainFeature` records with rank, type, name, point, elevation, prominence, elevation advantage, viewshed, dead ground, defensibility, mobility influence, corridor control, composite score, recommended use, and cautions.
- Default defensive composite:
  - 25% elevation advantage and prominence
  - 25% observation or viewshed coverage
  - 20% defensibility
  - 15% avenue or chokepoint control
  - 10% dead-ground and concealment utility
  - 5% isolation and accessibility
- Mission modes change weights only after raw metrics are calculated.

## Map Visualization
- Dedicated Mission Planner layers:
  - ranked feature markers
  - AO boundary
  - observer points
  - corridor influence overlays
  - labels
  - report snapshot layer
- SceneView gets score-scaled markers and elevated labels through ArcGIS symbology where available; MapView uses clean 2D fallback.
- Clicking a ranked result zooms to the feature and shows its tactical attributes in the list/report.

## Analysis Workflow
- AO source order:
  - selected graphic geometry
  - current view extent
- Run sequence:
  - detect local peaks
  - detect key terrain forms
  - seed observer candidates from active observers and top peaks
  - run dead-ground summaries
  - run defensibility scoring
  - run OCOKA corridor extraction
  - score corridor and chokepoint influence
  - generate ranked results
- Rapid what-if can reuse cached terrain and rerun observation/dead-ground/final ranking in a later optimization.

## Report Generation
- No new PDF dependency.
- Generate printable HTML in the Report tab and rely on browser print-to-PDF.
- Export ranked results as GeoJSON and CSV.

## Test Plan
- Build: `npm run build`.
- Manual test:
  - open dashboard from `More Actions...`
  - run with current 3D SceneView extent
  - switch to 2D and confirm graceful fallback
  - add friendly and enemy observer points
  - verify standalone Local Peaks, Key Terrain, Dead Ground, OP Ranker, PosDef, and OCOKA widgets still open independently

## Acceptance Criteria
- Dashboard produces a ranked key terrain list.
- Each result includes military attributes, not just geometry.
- Map graphics correspond to the ranked list.
- Settings toggles load and unload the tool correctly.
- Report can be printed/exported without extra packages.
