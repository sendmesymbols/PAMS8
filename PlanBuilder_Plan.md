# Plan Builder — terrain-aware baseline plans

Status: **proposal, 12 Nov 2026**. Nothing built yet.
Related: `OCOKA_Roadmap.md` (ch. 1–7), `claude_rules.md` (terrain bundle optional), `MS/Engines/DeploymentBuilder/`.

---

## 1. Goal

The planner gives the task, echelon and layout. The tool lays out a doctrinal baseline plan on the ground, shows why
each piece sits where it does, and gives a list of what to confirm on the ground. The planner then adjusts the plan.

- **Operations:** defence, attack, water crossing and bridgehead, ambush, patrol, recce. Withdrawal and cordon come later.
- **Layouts:** two up, three up, one up, all round, canal / ditch defence, reverse slope. An **Auto** mode ranks the
  layouts the ground allows.
- **The ground drives it:** enemy approaches, NO-GO / SLOW-GO, obstacles, ITG, sight and dead ground, weapon ranges,
  distance from the enemy.
- **Alternate and supplementary positions**, a what-if mode (the enemy shifts flank, a locality is shelled), and a
  trigger table.
- **Check my plan:** the same rules run against a plan the user drew by hand.
- **Without the terrain bundle**, recipes still work as geometry on open ground. Every part that needs the ground is
  hidden.

### What it is not

- **Not a replacement for recce.** The output is a plan plus a recce task list. With 30 m pixels and many bridges of
  unrecorded class, every product says what to confirm.
- **No enemy, own-force or live weather data.** The enemy is what the user marks. Every result shows its assumptions.
- **Not a black box.** Every placement and every score has a reason and a data date
  ("NO-GO: canal, 2021 land cover").

---

## 2. What exists and is reused

| Need | Reuse | Notes |
|---|---|---|
| Stamping a fixed plan | `DeploymentBuilderEngine.ts` (anchor + bearing) | Kept as it is; recipes appear beside saved plans |
| Enemy approaches | `findAvenue` (`GroundGuideOcoka.ts`), avenues in `GroundGuideOcokaRead.ts` | NO-GO never crossed, SLOW-GO dearer, chokepoints for a frontage |
| Lines of defence, MITG, origins | `readAor` (`GroundGuideAor.ts`) | Lines W/X/Y/Z, roles, frontage test, `originsAssumed` |
| Threat direction / place | `GroundGuideThreat.ts` marker | Docked = bearing, dragged = place |
| Frontage, depth, intergap | `GroundGuideFootprint.ts`, `OcokaDoctrine.frontage` | IBB Annex U/V, IC s113 rows |
| Sight, fields of fire, dead ground | `analyseSight`, `fireOf`, `sightTo`, `obstacleFrontOf`, `dominanceOf`, `waysOut` | Probability, not yes/no |
| Weapon ranges | `Rng` in `Symbols.json` (90 entries) | min / effective / max, night sights, basis + source |
| Weapons per echelon | `OcokaDoctrine.echelonOrganic` | Sec, Pl, Coy, Bn |
| Standoffs | `OcokaDoctrine.standoff` | FUP 1000–1200 m, BOF tanks 2500–3000 m, mask posns 300–500 m |
| Obstacle figures | `OcokaDoctrine.obstacles`, Mov Guide Water card (Annex P) | Canal types, bank heights |
| Reverse slope | `OcokaDoctrine.reverseSlope`, G3 military crest | |
| Threat sets | `OcokaDoctrine.threatSets` | Armour / infantry / artillery / combined arms |
| Speeds | `MovementSpeeds.json` | Time to occupy, enemy arrival time |
| Ambush, block, patrol, infiltration, picket, cordon | `MovementGuidePlans.ts` | `ambushSites`, `roadBlockSites`, `planPatrol`, … |
| Patrol card, night march | `patrolCard` (PlatoonGuide), `NightMarchRead.ts` | APIs kept stable |
| Reading the bundle | `MovementGuideProbe.ts` pattern | Own instances, created only while switched on |
| Creating symbols | `SymbolEngine.loadSymbolFromJSON` | Same path as the Mov Guide's "Create on Map" |

### Gaps found

1. **`Plans/Own/Bn Def.json` is an attack plan.** Its overlay type is "Bn Attk Plan", and it holds FUP, SL and Sp Attk
   in the same counts as `Bn Attk.json`. A real Bn Def sample is needed (user to supply).
2. **Missing symbols** (see §9): FDL, Gun Area, LOE, FPF, Security Zone (area), Mask Posn.
3. **No enemy doctrinal template yet** (roadmap ch. 8): assembly area 2–3 km from contact, 100 m in 4 min against
   prepared defences, lanes 400–500 m apart, night attack frontages.

---

## 3. Principles

1. **Recipes, not drawings.** A plan is a set of *slots* (roles) with *rules*. Coordinates are an output, never an input.
2. **Doctrine is data.** Every figure lives in `MS/Data/PlanDoctrine.json`, with `src` and a basis code (D = pamphlet,
   E = proposal), as in the other doctrine files. Nothing tactical is hard-coded in TS.
3. **Pure engine, thin view.** The solver and checks are pure TS that runs in Node (`tools/planbuilder-test/run.mjs`).
   The browser side only reads the bundle and draws.
4. **Safety first** (this follows an earlier decision of yours). Never overstate cover, going or coverage.
   - A rule the tool cannot check is **grey "not checked"**, never green.
   - Ties go to the safer option.
   - Point to better ground and say what to check on the ground.
5. **The terrain bundle is optional** (`claude_rules.md`). When the switch is off, the tool loads nothing. When the bundle
   is missing, there is one log line and the tool falls back to geometry.
6. **Ordinary symbols out.** The output is normal PAMS8 symbols in one overlay, editable with Morphix, saved with plans and
   exportable. Recipe metadata rides on each graphic's attributes (`pb.role`, `pb.planId`) so "Check my plan" and
   what-if can find them again.
7. **Library rules.** The engine is headless, can be torn down (`destroy()`), and keeps document-level events scoped to
   its view.

---

## 4. Architecture

```
MS/Engines/PlanBuilder/
  PlanBuilder.ts            engine: lifecycle, settings, view switch, wiring, destroy()
  PlanBuilderTypes.ts       Recipe, Slot, Rule, PlanInput, PlanResult, Check, Trigger …
  PlanBuilderRecipes.ts     loads + validates recipes (schema check, unknown rule names reported)
  PlanBuilderSolve.ts       PURE: candidate generation, scoring, slot placement in dependency order
  PlanBuilderRules.ts       PURE: one function per rule kind (geometry rules + terrain rules)
  PlanBuilderApproaches.ts  PURE: enemy approaches from origins/threat, sized to the enemy frontage, time-distance
  PlanBuilderScore.ts       PURE: layout score card, Auto ranking, compare
  PlanBuilderAlt.ts         PURE: alternate / supplementary / depth positions, what-if, trigger table
  PlanBuilderCheck.ts       PURE: "Check my plan" — map drawn symbols to roles, run the rules
  PlanBuilderProbe.ts       bundle reader (MovementGuideProbe pattern); a FlatProbe when terrain is off
  PlanBuilderWizard.ts      the five-step panel (DOM)
  PlanBuilderMap.ts         ghosts, approach bands, rule lines, what-if overlay (layer ms-plan-builder)
  PlanBuilderText.ts        Copy as Text: appreciation, trigger table, confirm-on-ground list
  PlanBuilderSettingsManifest.ts / PlanBuilderSettingsWidget.ts   ⚙ menu + Ctrl+K
MS/Data/PlanDoctrine.json            figures and rules (D / E), with sources
MS/Data/Deployments/Recipes/*.json   one file per recipe (bn-def-two-up.json …)
MS/Docs/19-plan-builder.md
tools/planbuilder-test/run.mjs       Node checks for the pure engine
```

- Loaded dynamically like the Deployment Builder: `features.planBuilder`. Off means not imported.
- The Deployment Builder widget lists recipes under their own heading. Picking one opens the Plan Builder wizard.
  Saved plans keep the old anchor + bearing stamp.

### Data flow

```
Recipe + PlanInput ──► Approaches ──► Solve (slots in order) ──► Checks ──► Score card
      ▲                    ▲                    ▲                    │
  PlanDoctrine        Probe / FlatProbe ────────┘                    ▼
                                                  Ghosts on map ◄─ PlanResult ─► Create on Map / Copy as Text
                                                                     │
                                                         Alt / what-if / trigger table
```

---

## 5. Data model

### 5.1 Recipe (`MS/Data/Deployments/Recipes/bn-def-two-up.json`)

```json
{
  "id": "bn-def-two-up",
  "task": "defence",
  "echelon": "16",
  "layout": "two-up",
  "name": "Bn Def — two up, one back",
  "family": "bn-def",
  "frontageRow": "Battalion, two companies up",
  "needs": { "terrain": false },
  "slots": [
    { "role": "killingGr", "sym": "25242300", "order": 1,
      "rule": { "on": "approach.main.chokepoint", "terrain": true } },
    { "role": "fwdL", "sym": "25151200", "label": "A Coy", "echelon": "15", "order": 2,
      "rule": { "across": "approach.main", "side": "L", "frontage": "Company, battalion two up",
                "prefer": ["itg", "highGround", "behindObstacle"], "sees": "killingGr", "inRangeOf": "killingGr" } },
    { "role": "fwdR", "sym": "25151200", "label": "B Coy", "echelon": "15", "order": 2,
      "rule": { "across": "approach.main", "side": "R", "gapTo": { "slot": "fwdL", "row": "Company, battalion two up" },
                "mutualSupport": "fwdL" } },
    { "role": "depth", "sym": "25151200", "label": "C Coy", "echelon": "15", "order": 3,
      "rule": { "behind": ["fwdL", "fwdR"], "distM": { "doctrine": "bnDef.depthCoyM" }, "coversGap": ["fwdL", "fwdR"] } },
    { "role": "res", "sym": "25214804", "label": "Res", "order": 4,
      "rule": { "behind": "depth", "reach": { "slots": ["cpen1", "cpen2"], "withinMin": { "doctrine": "cpen.coyMin" } } } },
    { "role": "atMines", "sym": "25270703", "order": 5,
      "rule": { "across": "approach.main", "inFrontOf": ["fwdL", "fwdR"], "depthM": { "doctrine": "minefield.protectiveDepthM" },
                "tieTo": "obstacle" } }
  ],
  "alternates": [ { "of": "fwdL", "kind": "alt" }, { "of": "fwdR", "kind": "alt" } ],
  "supplementary": "perSecondaryApproach",
  "checks": ["mutualSupport", "gapCover", "deadGroundFront", "flanks", "fieldOfFire", "backBlast", "dfMinRange"]
}
```

- **`order`** sets the placement order. Slots that depend on others come after them.
- Numbers come from **`{ "doctrine": "path" }`** references into `PlanDoctrine.json`, so one figure is changed in one
  place.
- **`needs.terrain: false`** means the recipe also works in geometric mode. A slot or rule marked `terrain: true` is
  dropped there, and the drop is shown.
- **Variations** are sibling recipes in one `family` (`bn-def-two-up`, `bn-def-three-up`, `bn-def-one-up`,
  `bn-def-all-round`, `bn-def-canal`, `bn-def-rev-slope`) that share role names. Auto and Compare work across a family.

### 5.2 Rule vocabulary

Rules are small and composable. Each returns `{ ok: 'pass' | 'warn' | 'fail' | 'unchecked', score, reason, dataDate }`.

| Kind | Rules | Needs terrain |
|---|---|---|
| Geometry | `distM`, `behind`, `ahead`, `side`, `across`, `squareTo`, `gapTo`, `frontage`, `depth`, `withinRangeOf`, `outOfRangeOf`, `bearingFromAxis` | no |
| Going | `onGround` (going classes per mover, dry / wet), `notIn` (NO-GO, built-up areas, water), `vehicleAccess` | yes |
| Sight | `sees`, `unseenFrom`, `fieldOfFireM`, `deadGroundFront`, `notOverlookedFrom` | yes |
| Ground | `prefer` (ITG, high ground, reverse slope, behind obstacle, built-up area), `onObstacle`, `tieTo` (canal / bund / NO-GO) | yes |
| Fire | `inRangeOf`, `mutualSupport`, `coversGap`, `backBlastClear`, `minRange` (DF, mortar), `fireLift` | geometry ok, sight yes |
| Time | `reach.withinMin` (own troops), `beforeEnemy` (time to occupy against enemy arrival) | route yes, else straight line marked |

### 5.3 PlanInput

```ts
interface PlanInput {
  recipeId: string;                  // or family + layout 'auto'
  echelon: string;                   // '14' Pl … '18' Bde (Div later)
  force: 'inf' | 'mech' | 'armd' | 'mtn';
  threat: { set: 'armour' | 'infantry' | 'artillery' | 'mixed';
            origins: Array<{ kind: 'bearing' | 'point' | 'area' | 'line'; geom: unknown; label?: string }>;
            assumed: boolean; enemyEchelon?: string };
  objective?: { kind: 'point' | 'area'; geom: unknown; sequence?: number }[];   // attack, patrol, recce
  anchor?: { at: MercXY; bearingDeg: number };    // geometric mode, or to pin the layout
  aor?: { outline: MercXY[] };                    // from Bdy symbols / AOR scale / dragged box
  obstacle?: { line: MercXY[] };                  // crossing / canal defence
  month: number; night: boolean; wet: boolean;
  approaches?: { main: string; secondary: string[]; ignored: string[] };  // picked in step 2
}
```

### 5.4 PlanResult

```ts
interface PlanResult {
  recipeId: string; layout: string; mode: 'terrain' | 'geometry';
  slots: Array<{ role: string; sym: string; geom: unknown; label: string;
                 checks: Check[]; status: 'pass' | 'warn' | 'fail' | 'unchecked';
                 alternatives: unknown[] }>;      // next-best spots, taken with J
  approaches: Approach[];                          // with width, going dry/wet, cover, time, chokepoints
  score: ScoreCard;                                // §7
  alternates: AltPosition[]; triggers: Trigger[];  // §8
  confirm: string[];                               // confirm-on-ground list
  assumptions: string[]; dataDates: Record<string, string>;
}
```

---

## 6. Inputs: the enemy and the objective

Step 2 asks for one thing, and what it asks for depends on the task. Each can be given in several ways.

**Defence: where the enemy comes from**

1. **Threat marker** (`GroundGuideThreat.ts`, reused). Left docked it is a bearing (`[` / `]` turn it). Dragged onto the
   map it is a place. Up to three can be placed, one per enemy origin.
2. **Draw the enemy start area or line** (an Area, or a Phase Line labelled "En FDL").
3. **From the AOR**: Bdy symbols or the AOR scale's outline. `readAor` gives the far-side origins and the flag
   `originsAssumed`.

**Attack, patrol, recce: what to take or watch**

1. Click a point, snapped to an ITG candidate, a village, a hill top or a junction. An Obj Area sized for the echelon is
   drawn round it.
2. Draw an Obj Area (`25151700`) or pick one already on the map.
3. Several objectives in order (Obj 1 → Obj 2) give the phases.

**Crossing: the obstacle.** Click the canal or river, or pick a reach. The Mov Guide Water engine classifies it
(Annex P type, home bank against far bank).

**Enemy symbols**: not read by default. This follows your OCOKA-lens decision: the threat is a marker, not enemy
symbols. An **opt-in** switch `planBuilder.threat.fromEnemySymbols` could read hostile symbols the user placed.
**Your decision is pending.**

Every result lists its assumptions ("En from NE, assumed; Bn strength").

---

## 7. Layouts, approaches and Auto

### 7.1 Enemy approaches (step 2)

- `findAvenue` runs from each origin to the defended area or MITG. It runs again with the first approach masked, to get
  the next one. Up to 3–4 approaches are found.
- Each approach is sized to the **enemy echelon's frontage** (enemy template). It is drawn as a band with its
  chokepoints and labelled with:
  - width at its narrowest against the frontage;
  - going dry and after rain;
  - cover along it (share of the route that is concealed);
  - **time for the lead tanks** (MovementSpeeds tracked speeds, plus the enemy template for the assault);
  - obstacles crossed (canal type, bridges, fords).
- The user marks each approach **main / secondary / ignore**. Selecting one highlights the slots that cover it.
- With the terrain bundle off, this step is hidden. The threat is a bearing and the plan is laid square to it.

### 7.2 Layout selector

`Two up · Three up · One up · All round · Canal · Rev slope · Auto`

- **A fixed layout** is fitted to the ground. Where the ground fights it, the slot turns amber or red with the reason
  ("C Coy locality 600 m wide, needs 1500 m").
- **Auto** fits every layout in the family and ranks them. Each one can be previewed as a ghost and taken. There is no
  hidden best answer.

### 7.3 Heuristic seed for Auto (PlanDoctrine `layoutHints`, basis E unless sourced)

| Ground | Suggested first |
|---|---|
| One main approach through a narrow front | Two up, astride it, depth behind |
| Two separate approaches | Two up, one Coy on each, reserve reaching both |
| Wide front, no obstacle, three approaches with tank going | Three up, less depth |
| Front on a canal or ditch | Canal layout: three up on the higher bank (IBB Annex V App 9: Bn 2750–4115 m, Coy 1200 m, gap 450 m, mask posns 900–1500 m) |
| No clear front (desert, isolated hill) | All round |
| Forward slope overlooked, crest controllable | Rev slope (`OcokaDoctrine.reverseSlope`) |

The hint only orders the list. The score card decides the ranking.

### 7.4 Score card (per layout, shown side by side in Compare)

| Check | Measure |
|---|---|
| Approaches covered | Per approach: who sees it, % of its killing ground under direct fire, anti-tank cover |
| Fits the frontage | Holdable width between obstacles against the frontage row |
| Gaps | Uncovered ground between localities; how to fill it (mines, fire or patrols) |
| Depth | Room for the depth Coy, C Pen posns, reserve; reserve time to each C Pen / CA obj |
| Flanks | Each flank rests on an obstacle or NO-GO ground, or is open (the open flank's length) |
| Exposure | Dead ground in front, overlooked from a flank, open to observed artillery fire |
| Alternates | Each FDL slot has an alternate it can reach in time (§8) |

- Each row reads pass / warn / fail / not checked, with a reason.
- The ranking orders by fails first, then warns, then a weighted score. The weights are in `PlanDoctrine.scoreWeights`
  (E), shown to the user and changeable.

---

## 8. Alternate, supplementary and depth positions; what-if

### 8.1 Kinds

| Kind | Used when | Rule |
|---|---|---|
| **Alternate** | The main position is shelled, located or untenable | Same task and killing ground; outside the main position's beaten zone; covered route; time to occupy < enemy time to arrive |
| **Supplementary** | The enemy comes from a flank or a secondary approach | Faces that approach; one per secondary approach not covered by the main layout |
| **Depth / C Pen** | Penetration | Astride the enemy axis, on an obstacle or built-up area, 2–3 per Bn; Coy C-attk in 30 min, Bn in 1 h; decision 1.5–2 h after enemy H hour (IBB) |

**Spacing figures:**
- AT alternates 800–1000 m, from the roadmap (IBB).
- For other weapons, the distance from the main position = the beaten-zone figure in `PlanDoctrine.alt.spacingM`. This
  is **basis E, for you to set**.

### 8.2 On the map

- Alternate and supplementary positions are Battle Posn with **planned status (SIDC digit 7 = 1, dashed)**, labelled
  "Alt A" or "Sup 2".
  - **To verify:** that `BattlePosition` draws dashed for planned status. If it does not, add it in the class.
- A dotted route joins each to its main position, labelled with the move time.
- **Show alternates** is a switch; off by default after Create on Map, so the main plan stays clean.

### 8.3 What-if

- **The enemy changes flank:** drag the threat marker to the flank, or switch on approach B. The tool:
  - shows the supplementary positions that come into use;
  - re-scores the plan with them occupied;
  - flags what is left uncovered while troops are on the move.
- **Heavy shelling:** click a locality → "Shelled". The tool shows the move to its alternate, the time taken, and who
  covers its killing ground during the move.
- **Penetration at X:** shows the C Pen posn that blocks it and the reserve's route and time.

### 8.4 Trigger table (in the plan and in Copy as Text)

| Trigger | Who moves | From → to | Route | Time | Covered meanwhile by |
|---|---|---|---|---|---|
| En on approach B | B Coy (–) | FDL → Sup 2 | Nullah, dead Gr | 25 min | Depth Coy MG + DF Tgt 7 |
| Heavy shelling, A Coy | A Coy | A → Alt A | Rev slope track | 15 min | Mor DF Tgt 3 |

Each row also goes on the confirm-on-ground list (route walked, time checked, alternate dug).

---

## 9. Operations and recipes

### 9.1 Defence (Coy, Bn, Bde)

| Slot | Symbol (key) | Main rules / figures |
|---|---|---|
| Security zone | Screen `25342203` / Guard `25342202` / Covering Tps `25342201`; Security Zone area **new** | Ahead of FDLs; depth by echelon (E) |
| OP / LP | `25160100` / `25160204` | LPs 300–400 m out; standing patrols 1000–1500 m (IBB) |
| FDL | **new local line** (until then Phase Line labelled FDL) | Joins the forward edges of forward localities |
| Localities | Battle Posn `25151200` | Frontage rows (§2); fields of fire 100 m minimum, 200 m + wire belt, 270–500 m desirable |
| Killing Gr / Engagement Area | `25242300` / `25151300` | On the main approach's chokepoint, in range of ≥ 2 localities |
| Arc of fire / PDF | `25152300` / `25140500` | Per locality, toward the approach |
| AT framework | Anti-tank symbols from the catalog | Flank shots from defilade, in depth; missile detachments 400–500 m apart; short-range AT 500–600 m forward; back-blast clear (`standoff`) |
| Obstacles | AT minefield `25270703`, wire `25290303`, AT ditch `25290203`, Block `25270501`, Turn `25270504` | Tied to canals, bunds and NO-GO; protective minefield 250–300 m deep; wire ≥ 40 m from posts; fill only the gaps |
| Mask posns | Battle Posn, label "Mask" (**new symbol optional**) | 300–500 m forward (canal: 900–1500 m) |
| C Pen posns | `25151201` | §8.1 |
| Reserve + CA | Res `25214804`, Counter Attk `25340600`, CA Obj `25140301` | Routes and times to each CA obj |
| Gun area | **new local area**; Fd Arty `10130300` inside | Behind, in range of DF targets (`Rng.ind`), out of enemy counter-battery reach where possible |
| DF targets | Tgt `25160303` | 8–12 per Bn; on enemy FUPs, assembly areas, defiles, dead ground; no closer than 400 m (field), 500 m (medium), 550 m (mortar); one emergency task on the most dangerous approach |
| Bdys / flanks | Bdy `25110100` | Open flank flagged with its length |
| Ready-by time | text | Coy position 24–36 h; digging hours by soil (`rci_*`) |

Layouts: two up, three up, one up, all round, canal, rev slope. Alternates and supplementary positions per §8.

### 9.2 Attack (Coy, Bn, Bde)

| Slot | Symbol | Rules / figures |
|---|---|---|
| Objective | Obj Area `25151700` | From step 2 |
| Assy Area | `25150200` | 1–5 miles from the enemy, unobserved, vehicle entry and exit; beyond field artillery range if possible |
| FUP | `25140302` | Unobserved; home side of minefields; 1000–1200 m from the Obj in plains (tanks 2500–3000 m) |
| Start line | `25140303` | A linear feature square to the axis, never behind an obstacle |
| Axis | Main Attk `25151403` / Sp Attk `25151404` | Along the chosen approach; no change of direction inside the FUP |
| Phase lines / LOE | `25140300` / **LOE new** | Phases from the Obj sequence |
| BOF | `25152100` | Higher than and to the flank of the assault; sees the whole Obj; layered in mountains, linear in plains |
| Fire lift rings | ring graphics | 450 m (120 mm mortar), 360 m (medium), 275 m (Bn mortar), 180 m (field) |
| Reorganisation | Arc of fire, DF | Toward enemy counter-attack approaches onto the Obj |
| Who leads | text | Open ground: tanks lead; fields of fire 400–500 m or less: infantry; 100–200 m or less: infantry, one tank troop at most |

Layouts: frontal, left flank, right flank, two-phase, night attack. Night attack uses the Night March chart and the
enemy night-sight / thermal rings. **Compare** shows left against right and the H-hour time sum.

### 9.3 Water crossing and bridgehead

- **Obstacle:** the Mov Guide Water engine: Annex P type, home and far bank, width, depth, current, bed.
- **Site ranking:** width, depth, banks, approaches and exits on both sides, cover on the home bank, fords, bridges and
  ferries nearby.
- **Bridgehead template:**
  - Bde phase 1: 300–600 m beyond the bund, 1800–2000 m wide.
  - Phase 2: 3500–4000 × 1500–1800 m.
  - Armd Div: about 8 × 6 km.

  The Bridgehead Line (`25141400`) snaps to ground the enemy must hold to observe the crossing, so the bridge sites end up
  out of observed fire where the ground allows.
- **Crossing area layout:** concentration area out of artillery range → Assy Area → boat off-loading point → FUP →
  vehicle waiting areas.
- **Crossing calculator:**
  - boats: 12 men, a 10-minute round trip per 30 m;
  - bridge build times by day, moonlight and dark;
  - entry point upstream by twice the width;
  - output: time for the whole force to be across.
- **Mirror recipe, canal defence:** bulk on the higher bank (the far bank if equal), bridges as strong points, mask
  positions 300–500 m forward, tracks behind the home bank, bridges to prepare for demolition.
- **Terrain off:** the user draws the obstacle line, and the template is laid by geometry. Site ranking and bank checks
  are hidden.

### 9.4 Ambush, patrol, recce

Recipes wrap the existing engines. Nothing is rewritten.

- **Ambush:** `ambushSites`; layouts line, L, V; killing zone (Killing Zone `25242302` / Ambush `25141700`), cut-offs and
  stops, RV 750–900 m back, covered withdrawal.
- **Patrol:** `planPatrol` + `patrolCard`; FRV 400–500 m from the Obj; bounds 550–750 m; route in different from
  route out; night chart through Night March.
- **Recce:** OPs on ITG candidates with sight to the area (Recce OP `25160206`), routes in dead ground, a recce task list
  (the confirm-on-ground list of another plan can feed it).

### 9.5 Later

- **Withdrawal:** intermediate position finder (far enough that the enemy must move field guns; behind an obstacle),
  control points, embussing point 1500–2000 m back, thinning-out timetable.
- **Cordon, picketing, convoy:** these already exist as Mov Guide cards. They would get recipe wrappers only.
- **Div echelon:** composed from Bde recipes.

---

## 10. UI: the wizard

A docked panel in the same family as the other guides: tokens from `GroundGuideTokens.ts`, never scrolls, pages walked
by a key. The opening key is chosen after checking `KeyboardShortcutManager` and the guides' keys for conflicts.

| Step | Shows | Terrain off |
|---|---|---|
| 1 Task | Operation, echelon, force, threat set, layout (`Auto` default when terrain is on), month, day / night, dry / wet; organic weapons listed with ranges | Same; `Auto` hidden |
| 2 Enemy / Obj | §6 inputs; approach bands with labels; main / secondary / ignore | Bearing or anchor only; approaches hidden ("needs terrain data") |
| 3 Fit | Ghost plan, per-slot pass / warn / fail / not checked; Auto ranking strip with a preview per layout | Geometry ghost; terrain checks grey |
| 4 Adjust | Drag slots, checks re-run live; **J** = next best for the selected slot; Compare; Show alternates; what-if | Drag + geometry checks |
| 5 Create | Create on Map (one overlay, `pb.*` attributes), Copy as Text, confirm-on-ground list, trigger table | Same, with "terrain not checked" in the text |

- **Ghost colours:** green / amber / red, and grey = not checked.
- **Rule lines** draw only for the selected slot (sight line to the killing ground, gap arcs, range rings) to keep the map
  readable.
- **Check my plan** is a button on the Deployment Builder widget and in the right-click menu on a selection. It maps
  symbols to roles by key and label ("A Coy", "FDL"), asks the user to confirm unclear ones, then shows the step 4 view
  without moving anything.

---

## 11. Terrain bundle off or missing (claude_rules.md)

Settings:

```json
"features": { "planBuilder": false },
"planBuilder": {
  "useTerrain": true,
  "bundleUrl": "/terrain-bundle",
  "recipesUrl": "MS/Data/Deployments/Recipes",
  "threat": { "fromEnemySymbols": false },
  "auto": { "enabled": true, "maxLayouts": 6 },
  "alternates": { "show": false },
  "map": { "ruleLines": "selected", "approachBands": true },
  "cacheTiles": 64,
  "useWorker": true
}
```

| State | Behaviour |
|---|---|
| `features.planBuilder` off | Engine not imported; no widget entries; recipes not listed |
| On, `useTerrain` off | **FlatProbe**: geometry only. No manifest, tile or worker requests. Steps 2–4 terrain parts hidden with "needs terrain data". Auto, Compare and approach bands hidden. Terrain rules = not checked (grey) |
| On, bundle missing / a file fails | One Engine Log line, then the same as `useTerrain` off. No dialogs, no retries, nothing thrown into the draw path |
| Switched off at run time | Tear down the layer, workers, listeners, caches and the open wizard. Symbols already created stay (they are ordinary symbols) |
| Right-click / planner entries | Terrain-only entries (Auto, Check terrain, Approaches) left out of menus when terrain is off |

Drawing a symbol must not change at all, with or without the Plan Builder.

---

## 12. Symbols to add

Before adding a local symbol, check whether 2525D already has the graphic (FPF and Limit of Advance may exist under
fire-support / maneuver control measures and only be missing from the catalog). Local symbols follow the Imp Gr pattern
(`00000160`, `MS/Symbols/ImpGr.ts`).

| Symbol | Geometry | Use |
|---|---|---|
| FDL | Line | Forward defended localities |
| Gun Area | Area | Artillery deployment area |
| LOE | Line | Limit of exploitation |
| FPF | Line | Final protective fire in front of a locality |
| Security Zone | Area | Covering-force / screen depth |
| Mask Posn | Area (optional) | Battle Posn label variant may do |

Also: alternate and supplementary positions through planned status (dashed) on Battle Posn (§8.2).

---

## 13. Phases

Each phase ships on its own, and the earlier phases work without the bundle.

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | Groundwork | `PlanDoctrine.json` (frontage, standoff, DF minimums, fire lift, alternates, layout hints, score weights, all with `src` and basis); recipe schema + validator; settings + Ctrl+K widget; missing symbols (§12); real Bn Def sample from you | Recipes load and validate in Node; symbols draw in 2D and 3D |
| 1 | Geometric recipes | Bn Def two up / three up / one up / all round, Coy Def, Bn Attk frontal; wizard steps 1, 3, 4, 5 in geometric mode; Create on Map; Copy as Text | Works with `useTerrain: false` and the bundle absent; no network requests (checked in the browser) |
| 2 | Terrain fit | PlanBuilderProbe; enemy and Obj inputs (§6); approaches step; snapping to ITG, high ground and obstacles; all terrain rules with reasons and data dates | Fit verified on screen at two real places (plain + canal); Node checks for every rule |
| 3 | Auto + Compare | Score card, ranking, side-by-side preview, J for next best | Auto picks differ sensibly between a narrow-front and a wide-front test place |
| 4 | Alternates + what-if | Alt / Sup / C Pen positions, routes and times, what-if (flank shift, shelled, penetration), trigger table | Trigger table in Copy as Text; time to occupy compared with enemy arrival |
| 5 | Check my plan | Role mapping, checks on drawn plans, sample plans checked | Runs on the sample Bde Def and Div Attk plans |
| 6 | Attack in depth | Assy Area, FUP / SL finders, BOF siter, fire-lift rings, left vs right + H-hour sum, night attack via Night March | |
| 7 | Crossing + bridgehead | §9.3 with the Water engine | |
| 8 | Ambush / patrol / recce recipes | Wrappers over Mov Guide, Platoon Guide and Night March | Existing card APIs unchanged |
| 9 | Withdrawal, Bde composition, Div | §9.5 | |

### Testing

- **`tools/planbuilder-test/run.mjs`:** Node checks for the pure engine on a synthetic grid
  (`node tools/terrain-synth.mjs` style): rules, solver order, layouts, score card, alternates, the geometric fallback,
  recipe validation.
- **Browser:** each phase verified on screen in 2D, plus a 3D smoke test.
  - With the bundle off, the network panel shows no `/terrain-bundle` requests.
  - Switching off at run time leaves no layer or worker behind.
- **TypeScript:** `tsc -p tsconfig.build.json` filtered to the new files.

---

## 14. Open decisions (yours)

1. **Enemy symbols as threat input:** opt-in, or markers only (§6).
2. **Name and key:** "Plan Builder" and a free key.
3. **E-basis figures to set:** alternate spacing per weapon, security zone depth per echelon, score weights, layout hints.
4. **First echelon and operation:** I'd start with Bn Def (needs your real sample) and Bn Attk.
5. **Recipe authoring:** JSON only at first. A later option is "save my plan as a recipe", which turns a drawn plan's
   offsets into slots with geometry rules.
6. **Alternates on Create on Map:** created hidden (Show alternates off) or visible.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Solver too slow at Bde size in the browser | Grid per slot search area only; worker; Bde composed from Bn fits |
| Over-trust in a neat-looking plan | Grey "not checked", reasons and data dates everywhere, confirm-on-ground list on every output |
| Doctrine figures differ between pamphlets | Keep both values with sources, as `OcokaDoctrine.frontage` does; the user picks |
| 30 m elevation misses ditches, bunds, walls | Sight is a probability; obstacles come from vector classes, not elevation alone; say so in reasons |
| Sample plans not representative | Real samples from you per operation before tuning Auto |
