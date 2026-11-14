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

1. **Samples.** `Plans/Own/Bn Def.json` **is** a Bn Def down to Coy level, with both sides on one overlay (corrected
   14 Nov 2026; I had first read it as an attack plan):
   - **own** (identity 3): an A Coy locality with three Pl posns;
   - **enemy** (identity 6): 10 Maratha's Bn attack on that locality (FUP, SL1 / SL2, Ph 1 / Ph 2, Atk 1–3, BOF,
     ATGM, MG, mortar, tank).

   `Bn Attk.json` is the mirror: own 10 FF attacks an en Coy locality. The Demo 2 overlays (§16) add a real
   **Div Def** and **Bde Def (12 Bde)**. Measured figures are in §16.6.
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
| Div on an obstacle along the IB (Demo 2, basis O) | Bdes three up on the obstacle; Div depth on a D line of planned Bn posns; a quiet sector held by one Bn + paramilitary troops + a dummy |
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
| 0 | Groundwork | `PlanDoctrine.json` (frontage, standoff, DF minimums, fire lift, alternates, layout hints, score weights, all with `src` and basis); recipe schema + validator; settings + Ctrl+K widget; missing symbols (§12); ORBAT / TO&E files (§17) | Recipes load and validate in Node; symbols draw in 2D and 3D |
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
3. **E-basis figures:** first values are now in §16.4, judged from Demo 2. They are yours to correct.
4. **First echelon and operation:** Bn Def (down to Pl), Bde Def and Div Def all have real samples now (§16).
   I'd start with Bn Def / Coy Def.
5. **Unit compositions (ORBAT / TO&E)** from you, to drive the slots, weapons and manpower (§17).
6. **Recipe authoring:** JSON only at first. A later option is "save my plan as a recipe", which turns a drawn plan's
   offsets into slots with geometry rules.
7. **Alternates on Create on Map:** created hidden (Show alternates off) or visible.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Solver too slow at Bde size in the browser | Grid per slot search area only; worker; Bde composed from Bn fits |
| Over-trust in a neat-looking plan | Grey "not checked", reasons and data dates everywhere, confirm-on-ground list on every output |
| Doctrine figures differ between pamphlets | Keep both values with sources, as `OcokaDoctrine.frontage` does; the user picks |
| 30 m elevation misses ditches, bunds, walls | Sight is a probability; obstacles come from vector classes, not elevation alone; say so in reasons |
| Sample plans not representative | Real samples from you per operation before tuning Auto |

---

## 16. Figures judged from the Demo 2 overlays (13 Nov 2026)

Source: `Material/plans/overlays/`, 11 overlays of one plan, **"Demo 2" (610 Corps)**. Basis code **O** = measured from
this plan. Distances are measured from the own-side IB trace, in plains (Kasur–Okara belt, facing east).

### 16.1 What each overlay is

| File | Overlay | Echelon (judged) | Side | Contents |
|---|---|---|---|---|
| `ipb.json` | 1-IPB | Div | ground | NO-GO / SLOW-GO, Bde and Div mobility corridors, 4 decision points |
| `ib-and-bdry.json` | 2-IB and Bdry | Corps / Div / Bde | own | IB, Bde bdys 10 / 11, Div bdy 31, Corps bdy, Div Line of No Pen, Corps and Army Lines of Denial, VG-1 / VG-2 |
| `sz.json` | 3-SZ | Div | own | 3 Covering Tps zones (BG2, BG3, one unnamed), Armd / Mech Bn battle groups |
| `en-cap.json` | 4-En Cap | En Div / Bde | enemy | 10 avenues, en phase lines, en Div / Bde, attack arrow |
| `def-plan.json` | 5-Def Plan | Div | own | 8 FDL Bn localities, 1 dummy, Rangers, D1–D5 and C1–C3 (planned), Coy strong pts, Bde HQs, Res, CA objs, DCB, DAA |
| `esp.json` | 6-ESP | Div | own | Minefields per Bn front, an 80 km belt, all-round fields round strong pts, water points |
| `arty-sp-plan.json` | 7-Arty Sp Plan | Div | own | 9 battery posns now + 6 planned further back, arcs of fire |
| `log-sp-plan.json` | 8-Log Sp Plan | Div | own | 3 BAAs, EME, medical, ordnance |
| `en-def-plan.json` | 9-En Def Plan | En Div | enemy | En Bn localities, C Pen posns, strong pts, Res, DCB |
| `…merged-overlays.json` | Merged | Div | both | **An older version** (Mar 2020) with different labels. Not mixed with the numbered set |
| `…def-plan-2-intl-border-and-bdry.json` | Def Plan 2 IB and Bdy | Div / Corps | own | IB, Div Line of No Pen, Corps / Army Lines of Denial, VG |

### 16.2 Cautions in the data (the builder and Check my plan must allow for them)

- **The echelon field is not reliable.** For example:
  - 25 AK is tagged Bde (18) in Merged but Bn in Def Plan;
  - 13 NLI is tagged Coy (15) in Merged;
  - 36 Sind has no echelon;
  - two "Coy" C Pen posns are the same size as the Bn ones;
  - the overlays' `echLvl` is empty.

  Judge echelon from the **label and size** first and the SIDC second, and show any disagreement.
- **Non-standard SIDC identities:** 8 is used for Rangers, and 7 / 8 / 9 / 10 / 16 for freehand colours. 2525D allows
  only 0–6.
- **Planned status (SIDC digit 7 = 1)** marks positions to be occupied later: D-line and C-line Bns, the gun areas
  further back, and three outlines drawn over FDL Bns. This matches the plan's use of dashed outlines for alternates and
  depth positions (§8.2).
- **Hidden meanings:**
  - The HQ/TF digit **1 = dummy**: "12 F" is a dummy Coy position.
  - **Names are reused**: D1–D4 are both depth Bn posns and the CA objs they counter-attack, and en C Pen posns are
    also D1–D5.
- **The merged overlay is a different version** from the numbered ones (12 FF / 12 F, 21 NLI / 21 Ranger, D1–D6,
  13 Baloch). Never merge the two.

### 16.3 Measured (basis O): obstacle-based Div defence on the IB, plains

| Item | Measured | Pamphlet check |
|---|---|---|
| Div frontage at the FDL | ≈ 85 km | IC s113: Inf Div 20–30 km, on an obstacle 60–80 km. Demo 2 is at or past the top end |
| Bde sectors at the FDL | 24 / 27 / 38 km (N / centre / S) | — |
| Bns up per Bde | Centre: 3 up. South: 3 up + 1 (–) 5 km back. North: 1 Bn + Rangers + a dummy Coy | Depth is held by the Div (D line), not a Bn back in each Bde |
| Bn locality, frontage × depth | 6.6–8.4 km (one 10.7) × 2.5–4.0 km, median ≈ 7.4 × 2.7 | IC s113 Bn obstacle-oriented 6000 × 3000 ✓ |
| Gap between Bn localities | 0.8–1.9 km, median ≈ 1.35 (one 4.1 km in the south) | Every gap has a minefield in front |
| FDL front edge from the IB | 9.4–14 km (N, centre); 15.6–19 km (S) | — |
| **Security zone (Div)** | IB → FDL 9.4–19 km. Covering Tps zones 6.5–10.5 km from the IB, 1–4 km ahead of the FDL minefields. 3 Armd / Mech battle groups across the front, each 20–28 km wide | — |
| Minefield in front of a Bn | Near edge 0.22–0.55 km from the locality (median ≈ 0.43); 0.5–2.1 km deep (median ≈ 0.86); about the Bn's frontage long | Inside the locality's MG range (`Rng` MG 800–1200) ✓ |
| Coy strong pts in depth | 2.6–3.2 × 2.0–2.9 km, 18–26 km from the IB (5–10 km behind the FDL); all-round minefield 0.3–0.43 km out | — |
| Bde HQ | 6–8 km behind the FDL front edge | — |
| Bde Res | 4–15 km behind the FDL front edge | — |
| Div Res | ≈ 21 km behind the FDL front edge (33 km from the IB) | — |
| Div Line of No Pen + DCB | ≈ 20.5 km from the IB; DCB on it | — |
| D line (depth Bns, planned) | 21.6–29 km from the IB (one at 36), just behind the Line of No Pen; 5–10 km edge to edge behind the FDL | — |
| Counter-attack | CA objs D1–D4 sit on the FDL localities; counter-attacks run 8–15 km from the D line | — |
| Corps Line of Denial / C line | ≈ 45 km; C1–C3 posns 49–53 km from the IB | — |
| Army Line of Denial | ≈ 88 km | — |
| Gun posns (now) | 14–22 km from the IB = 2–5 km behind the FDL front edge; arcs reach 14–20 km past the IB (155 mm class) | Covers the en Bn localities (11–18 km) and part of their C Pen posns (19–25 km) |
| Gun posns (planned) | 32–46 km from the IB, 17–20 km behind the present ones; arcs cover the ground in front of the D line | These are **depth gun areas for the D-line battle**, not alternates after shelling |
| BAA | 3.8 × 2.6 km, one per Bde, 11–17 km behind the FDL | — |
| DAA / Div log | 6–11 × 6–7 km, ≈ 43 km from the IB, just in front of the Corps Line of Denial | — |
| Enemy defence (mirror) | Bn localities 11–18 km from the IB; C Pen posns 19–25 km (6–8 km behind their FDL); Res 21–24.5 km | Gives the enemy template a depth figure |
| Enemy avenues | 10 axes, each 5–16 km, plus Bde / Div mobility corridors in the IPB | — |

### 16.4 The open figures

The overlays do not show alternates after shelling, Bn or Bde security zones, or how the planners weighed one thing
against another. Where Demo 2 shows nothing, the figure below is my proposal (**E**), with the reason. You correct them.

**Alternate spacing** (main → alternate, centre to centre):

| Element | Figure | Basis / reason |
|---|---|---|
| ATGM detachment | 800–1000 m | D (roadmap, IBB) |
| Section / Pl post | 150–300 m, inside the Coy locality | E: clear of the sheaf of one medium battery on the post (about 200 m wide) |
| Coy locality | 500–1000 m, inside the Bn locality | E: Demo 2 Bn localities are 2.5–4 km deep, which leaves room |
| Mortar (81 / 120 mm) | 300–500 m | E |
| Gun battery | 1–2 km, inside the gun area | E. Demo 2's planned gun areas 17–20 km back are depth positions; the recipe keeps both kinds |
| Bn (Div defence) | Uses the **D line** (5–10 km behind, planned status) rather than a nearby alternate | O |

**Security zone depth by echelon:**

| Echelon | Figure | Basis |
|---|---|---|
| Div, obstacle defence on the IB | IB → FDL 10–19 km; covering Tps 1–4 km ahead of the FDL minefields | O |
| Bde, when it alone provides its security | 3–5 km ahead of the FDL | E (about a third of the Div figure; to be checked against a Bde sample) |
| Bn | Standing patrols 1000–1500 m; LPs 300–400 m | D (IBB) |
| Coy | LPs 300–400 m | D (IBB) |

**Score weights** (E, judged from what Demo 2 spends its effort on):

| Check | Weight | Why |
|---|---|---|
| Approaches covered | 0.25 | Arcs and localities face all 10 en avenues |
| Depth and counter-attack | 0.20 | Four layers (FDL → strong pts / Bde Res → D line → C line); a CA obj on every FDL Bn |
| Obstacle tie-in | 0.15 | A minefield 0.2–0.55 km in front of every FDL Bn; DCB on the Line of No Pen |
| Gaps | 0.15 | Bn gaps 0.8–1.9 km, each closed by a minefield |
| Flanks | 0.10 | — |
| Exposure | 0.10 | — |
| Alternates | 0.05 | Demo 2 relies on the D line rather than close alternates |

**Layout hint added to §7.3** (basis O): in an obstacle-based Div defence on the IB, Bdes go **three up on the obstacle**,
and the Div holds depth on the D line with planned Bn posns. A Bde with a narrow or quiet front holds it with one Bn,
paramilitary troops and a dummy position.

### 16.5 Samples added to the Deployment Builder

| Entry | File | What |
|---|---|---|
| Div Def | `Plans/Own/Div Def.json` | The own overlays 2, 3, 5, 6, 7, 8 as separate overlays (126 symbols). IPB and the enemy overlays are left out: IPB is tied to its own ground, and the enemy overlays are not own deployment |
| Bde Def (12 Bde) | `Plans/Own/Bde Def 12 Bde.json` | The centre sector between Bdy 10 and Bdy 11 (34 symbols). The 80 km minefield belt and the Div VG are left out, and the IB is cut to the sector |

Both load in the Deployment Builder, and the Bde Def was placed on the map in the browser (13 Nov 2026).

### 16.6 Bn Def sample, Coy level (`Plans/Own/Bn Def.json`, 1 PR, both sides; basis O)

| Item | Measured |
|---|---|
| Own Coy locality (A Coy) | 2.3 km E-W × 3.2 km N-S |
| Pl posns (3) | 0.6–0.85 × 1.2 km each, all inside the Coy locality |
| Gap between Pl posns | 0.24–0.43 km |
| En FUP → own Coy locality | 3.4 km (IBB tank FUP 2500–3000 m; the en attack is armour-supported) |
| En SL1 / SL2 | 2.4 km / 0.6 km (two phases) |
| En BOF | 1.1 km; ATGM 0.8 km, HMG 1.0 km, mortar 1.2 km, tank 1.4 km from the locality |
| En Ph 1 / Ph 2 | Drawn round the own locality (the en objectives) |
| En axes | Three Sp Attk axes, one ending inside each Pl posn |

So the sample gives both recipes: a Coy Def (three Pls) and the en Bn attack template laid against it. Read as a
"Check my plan" case, the defender can see the en FUP 3.4 km out, the BOF at 1.1 km and the three axes, and the checks
can be tested against them.

---

## 17. Unit compositions (ORBAT / TO&E): what they add and the format wanted

Today a recipe has to guess what an echelon holds. `OcokaDoctrine.echelonOrganic` names the weapons but gives no counts,
and `OrganizationV3.json` holds only symbol entries.

### 17.1 What they add

| Plan Builder part | What the ORBAT drives |
|---|---|
| Slots | How many sub-units a recipe lays out (4 rifle Coys? 3 Pls + a weapons section?), so two up / three up / one up come from the unit itself, not a fixed recipe |
| Variations | Inf (standard, mech, mtn, light / cdo), Armd (regt, recce, tank type), AD (gun, msl): each has its own recipe family |
| Fire | Weapon counts × `Rng` → range fans, mutual support, gap cover, AT layout (e.g. 6 ATGM → 3 pairs 400–500 m apart), mortar and DF task counts |
| Manpower | Cordon (15 per 100 m), picketing, wire and mine laying labour, digging hours, posts that can be manned at once |
| Vehicles | Assembly area and harbour size, march tables (Move Planner already counts vehicles), what can cross a class 40 bridge |
| AD | Fire units → coverage circles, how many vulnerable points can be covered |
| Armour | Tanks in the reserve → counter-attack force ratio against the en template |
| Force ratios | Own ORBAT against the en template (KYE 2019): ≥ 3 : 1 at the point of attack, flagged when short |
| Echelon checks | The expected size per echelon fixes the unreliable echelon tags in old plans (§16.2) |
| Command | Who is under whom (under command / in support / attached) → which slot belongs to whose recipe, and what a Bde can give a Bn |

### 17.2 Format wanted (one file per unit type and variant)

```json
{
  "id": "inf-bn-std",
  "name": "Inf Bn (standard)",
  "echelon": "16",
  "sidc": "10031000161211000000",
  "variantOf": null,
  "manpower": { "offr": 0, "jco": 0, "or": 0 },
  "subunits": [
    { "role": "rifleCoy", "unit": "inf-coy-std", "count": 4 },
    { "role": "supportCoy", "unit": "inf-sp-coy", "count": 1 },
    { "role": "hqCoy", "unit": "inf-hq-coy", "count": 1 }
  ],
  "weapons": [ { "key": "15110202", "name": "GPMG", "count": 0, "heldBy": "rifleCoy" } ],
  "vehicles": [ { "key": "…", "name": "…", "count": 0, "vehCat": "B" } ],
  "attachments": [ { "unit": "armr-sqn", "relation": "underCommand", "when": "defence" } ],
  "terrain": ["plains", "desert"],
  "source": "TO&E reference + date"
}
```

- `weapons[].key` and `vehicles[].key` point at Symbols.json entries, so ranges (`Rng`), movers and `VehCat` come along.
- **Counts down to Pl / section** for Inf, **troop** for Armd, **fire unit** for AD.
- **Typical attachments per operation** (a Bn in defence gets a tank troop and an ATGM section, etc.), if there is a
  standard.
- **The en side** comes from the same format filled from KYE 2019.

### 17.3 Handling

These files are likely classified. They stay local:
- `MS/Data/Orbat/`, **git-ignored like the terrain bundle**, unless you say otherwise;
- never sent anywhere;
- loaded only when `planBuilder.orbat` is on.

When they are absent, the recipes fall back to the doctrinal defaults with "ORBAT not loaded".
