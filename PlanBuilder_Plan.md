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

> **Changed 15 Nov 2026:** it is the Deployment Mgr's **Build** tab (§14), so the files below go in
> `MS/Engines/DeploymentBuilder/` with a `Plan` prefix (`PlanRecipes.ts` first), not in a `PlanBuilder/` folder. The
> settings keep the `planBuilder` name.

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

**Built 15 Nov 2026 as in MIL-STD-2525D** (user: missing symbols are made as 2525D has them; a local symbol only where 2525D has none). Codes from the 2525D control-measure table, shapes from DISA's 2525D template drawings (Esri joint-military-symbology-xml SVGs; the JCS PDF refused the download).

| Plan item | 2525D symbol (catalog key) | Class | Shape |
|---|---|---|---|
| FDL | Forward Edge of the Battle Area, FEBA (`25140400`) | `Feba` | line or curve, "FEBA" past each end |
| LOE | Limit of Advance, LOA (`25140900`) | `LimitOfAdvance` | line or curve, "LOA" above it just inside each end |
| FPF | Final Protective Fire (`25240703`, Fires / Linear Targets) | `Fpf` | line, a tick square to it at each end (both sides), "FPF" under the middle; T1 = target number |
| Gun Area | Position Area for Artillery, PAA rectangular (`25240501`) / circular (`25240502`) | `PaaRect` / `PaaCircle` | rectangle (two corners) or circle (centre, edge); "PAA" in four gaps in the outline, upright; drawn as a polyline like Battle Posn |
| Security Zone | none in 2525D: local `00000161` | `SecurityZone` | area with "SZ" inside |
| Mask Posn | Battle Position (`25151200`) with the designation "MASK" | existing `BattlePosition` | no new symbol |

Lettering is geometry (`MS/Support/StrokeFont.ts`), so it scales with the symbol and draws the same in 2D and 3D.
Bases: `____LabelledLineBase.ts` (lines; DRAW_TYPE 1 straight, 2 curve through `CTRL_PTS`),
`____PositionAreaArtilleryBase.ts` (PAA; also builds the shape from two quick clicks with no mouse move between them),
`____LabelledAreaBase.ts` (Security Zone).

**Curves and widths for Create on Map (Phase 1):** existing symbols take `CTRL_PTS` (the clicks; DRAW_TYPE picks
straight, curve or smooth polygon) and, for arrows, lanes and similar, `BASE_LN_PTS` (the base line that sets the
width; e.g. `InfiltrationLane.ts`, `SupportByFirePosition.ts`). The builder writes both, so a Battle Posn follows the
ground as a smooth curve and an attack arrow has a real width.

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
| 6 | Attack in depth | Assy Area, FUP / SL finders, BOF siter, fire-lift rings, left vs right + H-hour sum, night attack via Night March | Built 15 Nov 2026 (attack.mjs); two phases 15 Nov 2026 (phase2.mjs) |
| 7 | Crossing + bridgehead | §9.3 with the Water engine | Built 15 Nov 2026 (crossing.mjs) |
| 8 | Ambush / patrol / recce recipes | Wrappers over Mov Guide, Platoon Guide and Night March | Built 15 Nov 2026 (smallops.mjs); existing card APIs unchanged |
| 9 | Withdrawal, Bde composition, Div | §9.5 | |

**Phase 0 built (15 Nov 2026):**

| Piece | Where |
|---|---|
| Figures and rules, each with basis and source (IC pages read from the text; IBB is a scan, so its figures are marked `pageToConfirm`) | `MS/Data/PlanDoctrine.json` (frontages, fields of fire and standoffs stay in `OcokaDoctrine.json`, referred to by `from`) |
| Recipe format, doctrine resolver, validator (pure, runs in Node and the browser) | `MS/Engines/DeploymentBuilder/PlanRecipes.ts` |
| First recipes: Bn Def and Coy Def, each two up / three up / one up / all round; slots carry a `seed` (geometry mode) plus `rule` (no terrain) and `terrainRule` (dropped without the bundle) | `MS/Data/Deployments/Recipes/*.json` + `index.json` |
| Checks: PlanDoctrine sources and bases, every recipe valid against Symbols.json, the ORBAT and the frontage rows, Coy posns at the doctrine size, and 13 broken recipes caught | `node tools/planbuilder-test/recipes.mjs` (62 checks) |
| Settings `features.planBuilder` (off) + `planBuilder.*`; ⚙ / Ctrl+K "Deployment Mgr: Build" | `Settings.json`, `PlanBuilderSettingsManifest.ts` / `Widget.ts` |
| Symbols as in 2525D (§12): FEBA `25140400`, LOA `25140900`, FPF `25240703`, PAA `25240501` / `25240502`; Security Zone local `00000161` (2525D has none); Mask Posn = Battle Posn | `MS/Symbols/`, `Symbols.json`, `Mapper.ts`; drawn in 2D and 3D |

**Phase 1 built (15 Nov 2026), geometry mode:**

| Piece | Where |
|---|---|
| Pure solver: recipe → posns at their seeds (Battle Posns drawn as curves whose open face carries the echelon), units, HQ, FEBA along the forward edges (all round: a ring), wire 40 m out, the protective minefield 200 m out and 250 m deep, LPs, standing patrol, ATGM pair in the gap, mortars, DF targets 8–12 (none nearer the FDL than 550 m, IC s111.4), alternates (planned, dashed, clear of every posn, move times); checks (frontage, depth, gaps, mutual support, facing the threat, reserve reach, alternates; the ground ones grey); Plan document; Copy as Text | `MS/Engines/DeploymentBuilder/PlanSolve.ts` |
| Bn Attk frontal recipe: Obj, FUP 1150 m short, SL, Main Attk arrow 400 m wide (`BASE_LN_PTS`), assault Coys, BOF on the right flank, reserve, HQ, mortars, LOE (LOA); checks FUP distance, assault frontage, BOF flank and range, mortars reach the LOE, fire lift, reserve reach | `MS/Data/Deployments/Recipes/bn-attk-frontal.json`, `PlanDoctrine.attack` |
| The Build tab: Samples / Build tabs in the Deployment Mgr; steps Task (operation, unit, layout, + Pl posns, alternates created hidden / shown / none, a preview from above), Enemy (geometry: a bearing), Place, Check, Create (Copy as Text). Place hands the plan document to the Mgr's own placement: ghost on the cursor, click the HQ (an attack: the Obj) then aim (an attack: toward the own side), one undo step, Last placement. Each graphic carries `pbRole`, `pbRecipe`, `pbPlanId`; hidden alternates hide their labels too | `PlanBuildTab.ts`, `DeploymentBuilderEngine.ts` (`setBuild`, `_placeBuiltPlan`), `Widgets.css`, `SymbolEngine.ts` (routes `features.planBuilder` / `planBuilder.*`) |
| Checks | `node tools/planbuilder-test/solve.mjs` (199) and `recipes.mjs` (64) |

Verified in the browser (2D): Bn Def two up and Bn Attk frontal built, aimed and placed (30 and 13 symbols), roles on every graphic, alternates and their labels hidden, removed with one step. In geometry mode the Build tab's only requests are the recipe files. Not yet verified: 3D placement of a built plan (the 3D scene did not draw in the test viewport).

**Phase 2 built (15 Nov 2026), terrain fit:**

| Piece | Where |
|---|---|
| Pure fit: frames (plan metres ↔ Web Mercator as the Mgr lays the plan); posns slide out of NO-GO on foot (nearest spot that does not fail, clear of the others, within `fit.slideMaxM`); per posn the ground (NO-GO / SLOW-GO / built-up share, top class), fields of fire (median clear distance over five rays across its front: IBB p279 200 m minimum, IC s72 270–500 m wanted), dead ground 300–1200 m out, overlooked from 0.5–1.5 km in front; the flanks (tracked NO-GO within 1 km, every 50 m); the tank approaches from the threat marker (or assumed 5 km out along the front) and which posns have each under direct fire (from the posn's nearest edge); the killing ground on the main approach 400–1000 m out, in reach, a chokepoint preferred; a score from `scoreWeights`. Attack: FUP hidden from the Obj, the going along the axis, the SL on a linear feature, the BOF's view of the Obj. Anything the ground cannot answer stays grey | `PlanFit.ts` |
| Ground reader: the Movement Guide's bundle reader with an instance of its own (tiles, worker, sight), approaches by the OCOKA engine's `findAvenue` on its grid (`MovementGuideProbe.gridAt`, added) | `PlanGroundProbe.ts` |
| The tab: Enemy step marks the threat on the map (the plan then faces it as it moves and one click places it); Auto on with the terrain; while placing, the quick ghost while the mouse moves and, after `fit.restMs` at rest, the fitted ghost (Auto: the best layout), the approaches in red with chokepoints, a ring per posn by its verdict, and a card at the cursor (ranking, worst check, slides); the click fits once more at that spot; Check and Copy as Text show the fitted checks and the bundle's data dates | `PlanBuildTab.ts`; Mgr hooks `setPlacementHooks`, `replaceSelectedPlan`, `PlanEntry.faceAt` |
| Checks on synthetic ground (lake under a posn, a wood in front of one, a canal on a flank, a road under the SL; no data never passes) | `node tools/planbuilder-test/fit.mjs` (26) |

Verified on the real bundle (2D): **canal** (BRB east of Lahore, enemy from the east): the plan faced the threat, two tank approaches 8–10 km found and both under fire, B Coy flagged half in a built-up area with about 100 m clear in front, dead ground about 78 %, placed fitted. **Plain** (near Okara, enemy from the east): Auto ranked two up 90, one up 88, all round 83, three up 82 (a posn with under 100 m clear), the killing ground placed on the main approach, a canal found on the right flank. **Attack** at the BRB: SL on a metalled road, FUP likely hidden, going clear, and the BOF failing (0 of 5 points of the Obj in view). Not yet verified: 3D, and the card and approach overlay in a full-size window (checked by script; one screenshot at the canal).

**Phase 3 built (15 Nov 2026), Auto + Compare + J:**

| Piece | Where |
|---|---|
| One layout fitted at one spot (`fitLayout`: solve, fit, solve again with the slides and the killing ground; the user's J moves laid under the fit's slides), shared by the tab and the Node checks. Auto's order `rankFits`: fewest fails, then warnings, then score, over every check the plan shows (geometry ones included), ties to the family's first layout | `PlanFit.ts` |
| Approaches: up to three (a third kept when it is a different way); judged where the enemy closes, the FDL to 1.5 km out, from the posn's nearest edge | `PlanFit.ts`, `PlanGroundProbe.ts` |
| HQ (the click's pivot) central between the forward posns and those behind them | `PlanSolve.ts` |
| **J** while the plan rests: the worst posn (fail, then warn) to the best spot round it (rings of 100 m to 1.5 x the slide limit, eight ways, the whole plan fitted for each); kept only if that posn does better **and** the plan ranks better; Auto stops on the shown layout; **Shift+J** takes the last move back; moving the mouse drops J's moves | `nextBestSpot` in `PlanFit.ts`; `PlanBuildTab.ts` |
| **Compare** (Check step, "Compare layouts"): every layout of the family fitted at the last spot, side by side: a preview each, the score-card rows (weights shown), score, fails / warns, "Use" | `PlanBuildTab.ts` |
| `features.planBuilder` now **on** by default: the tab loads nothing (no bundle, no worker) until it is opened | `Settings.json` |
| Checks: narrow front (lakes either side of a 3.8 km gap) → Auto two up, three up below; wide front (three approaches 3.2 km apart) → Auto three up, two up leaving one uncovered; J moves B Coy off a wood (warn → pass) and never leaves the plan worse | `node tools/planbuilder-test/fit.mjs` (37) |

Verified on the real bundle near Okara: J moved B Coy 300 m and took the plan from 2 fails to none; a second J found nothing better; Shift+J restored it; Compare ranked one up 89 (0 fail, 5 warn) over two up 88 (2 fail), three up 83, all round 81.

**Phase 4 built (15 Nov 2026), alternates + what-if + trigger table on the ground:**

| Piece | Where |
|---|---|
| Routes on foot over the ground at the IPB rates (p 18: GO 4, SLOW-GO 2.4 km/h by day), a shelled move half as long again (E), + 5 min to settle; a route that would cross NO-GO goes round it (one waypoint either side, up to 1.5 km off the line, E), or is reported "no route", never drawn through; the share of it hidden from the enemy 2.5 km out on the main approach | `routeOnFoot` in `PlanWhatIf.ts` |
| The enemy's lead tanks along the approach at the IPB vehicle rates (GO 24, SLOW-GO 16 km/h) from the threat marker (or the assumed start) to the place | `PlanWhatIf.ts` |
| Triggers: heavy shelling on each forward posn → its alternate (an alternate on NO-GO fails); the enemy on each secondary approach → the reserve to a **Sup posn** facing it where it closes on the FDL; penetration on the main approach → the reserve to a **C Pen posn** astride it 400 m behind the FDL. Each: route, own time, the enemy's time, verdict (pass when he needs twice the move or more, warn when less, fail when he is there first: `PlanDoctrine.moves.margin`, E) and who covers meanwhile | `whatIf`, `withMoves` in `PlanWhatIf.ts` |
| Sup and C Pen posns go into the plan as planned (dashed) Battle Posn / C Pen Posn, hidden / shown / none with the alternates; a "Moves in time" row in the checks, counted in Auto's ranking | `PlanSolve.ts` `extraPosns`, `PlanWhatIf.ts` |
| Check step: the trigger table, "Show the routes on the map" (dashed, each with its minutes); the routes also drawn while the plan rests; Copy as Text carries the trigger table with own and enemy times | `PlanBuildTab.ts`, `planText` |
| Labels on built plans at half size (`planBuilder.labelSize`, 7 pt, in Ctrl+K) | `PlanSolve.ts`, `PlanBuildTab.ts` |
| Checks | `node tools/planbuilder-test/whatif.mjs` (18) |

Verified on the real bundle at the BRB canal (enemy from the east, placed in **3D**): 34 symbols with the killing ground, two Sup posns and the C Pen posn; labels 7 pt; three approaches; the enemy's lead tanks at the FDL in about 37 min; the shelled moves to the alternates in time but tight (22 against 39–41 min, warn); the reserve on foot too slow for both secondary approaches (49 against 40, 59 against 47 min round NO-GO: fail) and only just in time for the C Pen posn (38 against 39). That is the trigger table doing its job: on that ground D Coy must be mounted, pre-positioned, or the Sup posns occupied before the enemy commits.

**The enemy and the ground (15 Nov 2026, with Phase 5; the user: "what echelon / size of enemy ... this will change lots of things"; "what is terrain, is it catered for?"):**

Before this, the enemy was only a direction (the threat marker), always tanks, and the ground was read cell by cell but its kind (plains, obstacle, desert, mountains) changed nothing. Now:

| Piece | Rule (source) | Where |
|---|---|---|
| **En force** (step 2): Coy / Bn / Bde / Div, Auto = one level up in defence (the attacker's 3 : 1, MW p 80), one level down in attack | force ratio row: an en Bde on a Bn passes (3 : 1), an en Div on a Bn warns (more than it holds alone), less than 3 : 1 = a probe or raid; strength about three of the level below per level (E) | `PlanDoctrine.enemy`, `PlanContext.forceRow` |
| Approaches sized to him | he attacks on the corridors of the level below him (IPB pp 7, 12: en Bn 500 m, Bde 1.5 km, Div 3 km); each approach says what it carries ("narrow: an en Bn at most"); the main approach is the first that carries his echelon; one that carries it must be under fire (fail), a narrower one wants a screen (warn); none wide enough is said | `PlanFit` (approaches), `approachCarries` |
| **En type**: Inf / Mech / Armd (Auto Mech; Inf in the mountains, MW pp 238-239) | Inf: approaches on foot, foot rates (IPB p 18), FUP 1000-1200 m (IBB p201); Mech / Armd: tracked, vehicle rates, FUP 2500-3000 m (IBB p214); the trigger table's times and wording follow | `PlanContext`, `PlanWhatIf`, `PlanGroundProbe.avenues(…, profile)` |
| En FUP | his likely FUP on the main approach at his FUP distance (or the one drawn): in view from a forward posn (pass) or dead ground (warn: OP / LP / standing patrol, DF target) | `PlanFit` |
| **Ground** (step 1): Auto / Plains / Obstacle / Desert / Mountains | Auto reads it where the plan rests (E): 400 m of rise within 5 km = mountains; canal, distributary, drain, embankment or bund in front of half the front inside 1.5 km = obstacle; half the ground within 3 km bare, sand or dunes = desert | `PlanDoctrine.terrain.detect`, `PlanFit.detectTerrain` |
| Obstacle | Bn up to 6 km (IC s113 obstacle-oriented), Bde 20-27 km (E: IC s113 Div 60-80 km over three Bdes), Div 60-80 km; a Coy is never extended (IC s84.6b); Auto tries three up first; the obstacle tie-in (each forward posn has it under its MGs, 700 m E; IBB Annex V App 9) | `frontageAllowance`, `PlanFit` |
| Desert | large gaps accepted (OOW1 s22 p68); the tank threat from any direction, the rear too (OOW1 pp 68-69: flanks never pass); all round first; foot 3 / 2.5 km/h (IBB p 18) | `applyContext`, `PlanFit` |
| Mountains | Bn up to 8 km (IC s113); forward posns at least 30 m above the main approach (E; MW pp 147-179 hold the dominating features); all round first; foot 3 km/h + 30-60 min per 300 m of climb (MW p 81) | `PlanFit`, `routeOnFoot` |
| Without the bundle | Auto is plains, assumed (grey row); a set kind still changes the frontage and gaps | `PlanBuildTab._withContext` |

**Phase 5 built (15 Nov 2026), Check my plan:**

| Piece | Where |
|---|---|
| The tab's **Build a plan / Check my plan** switch. Check reads the selected symbols, the last placement or every symbol on the map (the records Save Plan writes, `SerializationEngine.planRecordsOf`; the Mgr's `readDrawn`; the host's selection), with the En force, Ground and threat marker inputs; Read and check; Copy as Text; rings by verdict, the approaches and the en FUP on the map; tiles that arrive later are read again | `PlanBuildTab.ts`, `DeploymentBuilderEngine.readDrawn`, `SerializationEngine.planRecordsOf`, `SymbolEngine` (host `selected`) |
| Reading (16.2 cautions): side from the identity (02 / 03 own, 08 Rangers, 05 / 06 enemy; freehand left out); echelon from the label ("A Coy", "27 FF"), then the SIDC, a unit inside, the size; planned status = depth / D line; an unlabelled planned outline over a held posn left out; a dummy by the HQ / TF digit; a posn holding two or more smaller ones is the plan's outline (the Bn Def sample: A Coy holding Pls 1-3 = a Coy plan); a Reserves symbol on its own = the reserve | `PlanCheck.readSymbols`, `mapPlan` |
| The front: the threat marker, else the enemy symbols, else what points at the enemy (arcs of fire, covering troops, protective minefields, FEBA, each from the posn held nearest it), a DCB only when nothing else is drawn: the 12 Bde sample's DCB lies in depth on the Line of No Pen | `mapPlan` |
| Forward = nothing of its own echelon in front of it in its lane (an FDL along a canal is not straight); roles can be changed by a click | `mapPlan`, the posns table |
| Defence checks: En force, Terrain, frontage (by echelon and ground), depth (posns held; the planned D line named apart), gaps (Coy / Bn plans: the IBB rows and mutual support; Bde / Div: accepted when a minefield or obstacle is drawn across, OOW1 p82), facing (only a posn facing otherwise than the rest is flagged: both samples mark the echelon on the rear side), posns in depth, reserve reach (mounted when armour sits in it), alternates, each posn's size; on the ground the fit in check-only mode (nothing slides), drawn en axes as his approaches, the drawn en FUP, the DCB tie-in from the symbol | `checkDefence` |
| Attack checks, per axis (matched to the en posn at its head, the FUP at its tail, the SL across it, the BOF nearest the Obj): FUP distance, SL square to the axis and between FUP and Obj, BOF on a flank and in range of the Obj's near edge, assault width; on the ground FUP unseen, the going, SL on a linear feature, the BOF's view; force ratio; en posns not attacked | `checkAttack` |
| The Plan Builder's tile cache at least 256: at Bde scale each posn's sight grid lies in other tiles and 64 thrashed (never loaded) | `PlanBuildTab._openProbe`, `Settings.json` |
| Checks | `node tools/planbuilder-test/check.mjs` (71: the enemy and ground rules on synthetic ground, and the Bde Def, Bn Def and Div Attk samples) |

Verified on the real bundle (2D): the **12 Bde Def** sample read as a Bde defence, 27 FF / 26 Punjab / 25 AK forward, D2 / D3 planned D line, the Reserves symbol as the reserve, the front east from the arcs, minefields and covering troops; frontage 25.6 km fails a Bde's 10-12 km on plains and passes with Ground: Obstacle (20-27 km); the one tracked approach (through the 26 Punjab - 27 FF gap) not under direct fire; fields of fire about 96 % dead ground; en FUP 2.7 km out in dead ground. The **Div Attk** sample: 23 axes, FUPs 2.3-3.9 km from the en posns, BOFs out of 106 mm range and blind to their objectives, one axis across water, force about 2.1 : 1. Not yet: the right-click "Check my plan" on a selection (§10), and 3D.

**The ground shapes the plan (15 Nov 2026, the user's sketch: a Battle Posn's echelon mark on its rear, enemy ahead; "can have curves and enclose ITG, near top plateau or higher ground, can be curved to suit the terrain features"; "underlying terrain changes frontages and move and pacing"; symbols carry CTRL_PTS for curves and BASE_LN_PTS for width):**

| Piece | Where |
|---|---|
| The echelon mark (the segment from a Battle Posn's last point back to its first) on the **rear** side of every built posn; Check my plan reads facing the same way (a posn whose mark is toward the threat is flagged) | `PlanSolve.BP_SHAPE`, `PlanCheck.mapPlan` |
| **Higher ground:** a posn not slid out of NO-GO moves up to 400 m (Bn) / 200 m (Coy) when its high ground (the mean of its five highest samples, so a knoll inside a 1.5 km posn counts) would stand 8 m or more higher (E) | `PlanFit` step 1b, `PlanDoctrine.fit.highGround` |
| **Curved outlines:** each point of a posn's curve moves in or out by up to a quarter: out over higher ground, in off NO-GO and water; the echelon segment stays; drawn through the posn's CTRL_PTS | `PlanFit` step 1c, `SolveOptions.outlines`, `PlanDoctrine.fit.outline` |
| **Attack axis on the ground:** the way on foot from the axis' tail to the Obj round NO-GO (`findAvenue`); when it bends more than 100 m the arrow becomes a curve through its CTRL_PTS, its BASE_LN_PTS width square to the first leg | `PlanFit.axisOnGround`, `SolveOptions.paths` |
| **Pace:** the assault's time along the axis over this ground (IPB p 18; desert IBB p 18; mountains MW p 81 with the climb), for the fire plan's lifts; built-up ground under a forward posn cites IC s55 (a Pl holds 100 m: the frontage shrinks) | `PlanFit.fitAttack`, `groundCheck` |
| Force ratio counted from the ORBAT's children: Coy 1, Bn 4 rifle Coys (pp 606-611), Bde 3 Bns, Div 3 Bdes; a posn and the unit symbol in it count once | `PlanDoctrine.enemy.levels`, `PlanCheck.strengthOfSide` |
| The front from cues measured from the centre of the posns held now (the nearest posn misread a protective minefield 200 m out); wire is not a ditch (only 252902xx / DCB facility tie a front) | `PlanCheck.mapPlan` |
| Checks: built posn's mark on the rear; a built plan read back by Check my plan (marker and no marker); a knoll in front moves A Coy up; a lake pulls an outline in; flat ground changes nothing; an attack axis bends round a lake with its width and pace | `node tools/planbuilder-test/check.mjs` (86) |

Verified on the real bundle in the Salt Range (32.72 N 72.95 E): Bn Def two up placed north; A, B and D Coy moved 400 m up onto ground 31-73 m higher, A and B Coy's outlines curved to the ground, echelon marks on the rear; read back by Check my plan as two forward, two in depth, Ground Auto = Mountains (about 490 m of rise within 5 km), the en an infantry Bde at 3 : 1, facing passed.

**The ORBAT wired in (15 Nov 2026, the user: "what is the benefit of MS/Data/Orbat/PK in all this?" then "wire the ORBAT"):**

| Piece | Where |
|---|---|
| A pure reader over the ORBAT files (fetched by the tab from `planBuilder.orbatUrl`, read from disk by Node; RESTD, never sent out): a unit's manoeuvre Coys / Sqns counted down its children (support, HQ and services left out; a child not printed judged from its role, E), Pls per Coy, all ranks, weapons with their `weapons.json` ranges, APCs; what the extraction lacks is said | `PlanOrbat.ts` (`brief`, `unitLine`) |
| **Unit type** (Task step, Bn plans): Std Inf / Mtn Inf / MIB / ABIB / Air Aslt / Mjd ...; a type with other than 4 manoeuvre Coys (Lt Cdo, LAT, HAT) shown but not offered (the layouts are for 4); what it holds under the chips | `PlanBuildTab._unitTypeRow`, `ownBnTypes` |
| **Ranges from the unit's own weapons**: the BOF's 106 mm RR, the 81 mm, MG mutual support (twice the MG1A3), the ATGM; a weapon the unit lacks keeps the doctrine figure | `doctrineForUnit` |
| **ATGM pairs from the unit's launchers** (a Std Inf Bn's 4 BS = 2 pairs, an ABIB's 6 = 3): the recipe's pair in the gap, the others on the tank approaches where they close on the FDL, 450 m apart across them, an approach the posted ATGMs do not reach first, then the main one (OOW1 pp 25, 44); without the ground, on the open flanks | `PlanFit.atgmExtras`, `SolveOptions.extraPoints` |
| **AT cover** (Mech / Armd enemy): each tank approach under ATGM fire, or only the forward Coys' RR, or nothing (fail on one that carries his main effort) | `PlanFit.atCoverRow` |
| **Mounted reserve** (a unit with APCs: MIB 60, ABIB 54): the reserve's moves to the Sup and C Pen posns on tracked going at the IPB vehicle rates, and the geometry Reserve reach | `PlanWhatIf.routeOnFoot(…, mounted)`, `SolveOptions.mountedReserve` |
| **Force ratio from both ORBATs**: own manoeuvre Coys against the enemy's unit from Sec 13 for his echelon and type (Bn: en Inf Bn / MIB / Armd Regt; Bde: IIB / RAPID Inf Bde / IAB; Div: Inf Div (Mtn Div in mountains) / RAPID (Def) / Armd Div); an IIB (12 Coys) on a Std Inf Bn (4) = 3 : 1; armour counted by Sqns, said to weigh more; Check my plan uses it when the enemy is not drawn | `forceFromOrbat`, `enUnitFor`, `PlanContext.forceRow`, `PlanCheck` |
| **Mines in time**: the protective minefield along the front at the p 439 rates (an Engr Pl 780 mixed clusters in 24 h, an Inf Pl half; 1 cluster a metre, E reading of the remark): one Engr Fd Coy, and the Bn's own rifle Pls, against the 24-36 h to be ready (IBB); over it, more engineers or the MML | `minefieldRow` |
| The level table for drawn symbols counts from the ORBAT's children (Bn 4 rifle Coys, Bde 3 Bns, Div 3 Bdes) | `PlanDoctrine.enemy.levels` |
| Copy as Text: the unit line and the enemy's | `PlanBuildTab._unitLine` |
| Fixed on the way: the what-if rebuilt its rows and dropped the En force / Terrain rows (and now AT cover) | `PlanWhatIf.withMoves` |
| Checks | `node tools/planbuilder-test/orbat.mjs` (33; 55 with step 1 below) |

Verified on the real bundle at the BRB east of Lahore (threat east): the plan placed with all 4 BS (the gap pair and the second pair on the main approach); En force the RAPID Inf Bde, 12 Coys on 4 = 3 : 1; Ground read as an obstacle (a distributary in front); AT cover pass on both approaches; mines 3.5 km in about 36 h for one Fd Coy; the reserve on foot to the C Pen posn 39 min against the enemy's 33 (fail), and as an MIB, mounted, 11 against 33 (pass).

Not wired yet: the other arms as own units to lay a plan for (armr, arty, engr, AD: read since 18 Nov, see below, but no plan uses them); en weapons for his ATGM ranges (his Std Inf Bn's ATGM has no range in weapons.json); the vehicles for march tables (the Move Planner does those).

**More of the ORBAT, step 1 (18 Nov 2026, the user: "What units are left? How can we include more units from the ORBAT?" then "build step 1"):**

| Piece | Where |
|---|---|
| **Every own arm file as one list** (inf, armr, arty, ad, engr, sig, avn, log, mov: 358 units, no id twice), so a child kept in another arm's file is found: the Inf Bde's Sig Coy (2,586 all ranks, was blank), the Indep Mech Inf Bde Gp's Armr Regt (its 6 BS, 124 APCs). inf.json, en.json and weapons.json must be there; an arm file that is missing is said in the log and left out | `PlanOrbat.OWN_ORBAT_FILES`, `mergeOwn`, `PlanBuildTab._loadOrbat` |
| **FC Wing and Rangers Wing** in the Type row (4 rifle Coys, 730 all ranks, pp 642-644). The FC Corps' Sp / HQ / Adm Wings have no rifle Coys and are left out. SSG and Coast Guards stay hidden (user's call, not yet made) | `ownBnTypes` |
| **Coy and Pl plans follow the type**: the Type row is on Coy plans ("Coy of") and Pl plans ("Pl of") too; one choice for all three. A Mtn Inf Bn chosen gives a Bn plan that Bn, a Coy plan its rifle Coy, a Pl plan that Coy's rifle Pl, read down the ORBAT's children. A Coy Def of a MIB Coy has a mounted reserve (13 APCs: Reserve reach 6 min against 11 on foot). An AT Bn (LAT, HAT) has no rifle Coy: not offered there. A Lt Cdo Coy (3 Pls) is offered for Coy and Pl plans; on a Bn plan the 3-Coy Bn was not taken until step 2 below | `subUnitsOf`, `typeFits`, `unitForPlan`, `PlanBuildTab._unit`, `_needOf`, `_unitTypeRow` |
| **Bde types** on a Bde plan: Inf Bde, IIBG, Indep Mech Inf Bde Gp (each 3 Bn-sized manoeuvre units). Today the only Bde plans are the crossings, whose times do not use the unit: the choice changes what the tab shows, Copy as Text and the unit Check my plan reads | `ownBdeTypes`, `_bdeId` |
| APCs counted down the children when the unit prints no vehicles of its own (the Mech Bde Gp's are its MIBs') | `apcsOf` |
| Fixed on the way: a towed howitzer read as an ATGM ("Towed" matched TOW); an Indep S&T Coy counted as a manoeuvre Coy (IIBG 13, now 12); a rifle Pl said to hold "12 rifle Coys" (a Pl now names no Coys, a Coy its Pls, a Bde or above "manoeuvre Coys" since armour Sqns are among them) | `brief`, `coysOf`, `sizeText`, `coyWord` |
| Checks | `node tools/planbuilder-test/orbat.mjs` (55) |

Verified in the app (dev server, terrain ready): Bn Def with the Rangers Wing (En force 3 : 1 against the RAPID Inf Bde); Coy Def as the Rangers' rifle Coy, the MIB's Mech Inf Coy (mounted) and the Lt Cdo Coy; Pl Ambush as the Mtn and Lt Cdo Pl; Bde Crossing with the three Bde types; LAT / HAT greyed on a Coy plan with the reason.

**More of the ORBAT, step 2 (19 Nov 2026, the user: "build step 2"): 3-Coy Bn layouts and AT Coys grouped to a Bn:**

| Piece | Where |
|---|---|
| **Two 3-Coy Bn Def layouts for the Lt Cdo Bn** (3 Lt Cdo Coys + an HQ Coy, p 623), in the Bn Def family beside the 4-Coy ones. **Two up, one back** (`bn3-def-two-up`): A and B forward as in the 4-Coy layout, C Coy the reserve 1350 m back; frontage 3.5 km in the two-up row's 4.5 km, depth 3.3 km in its 3.0-4.0 km, Reserve reach 30 min. **Three up, none back** (`bn3-def-three-up`): A, B, C forward (5.5 km in the 6.5 km row), no Coy left for a reserve, so the Depth row warns (700 m against 2.5-3.0 km) and there is no Reserve reach row: ask Bde for a reserve. Both basis E (the book prints these rows for four Coys; the three-Coy layouts are mine) | `Recipes/bn3-def-two-up.json`, `bn3-def-three-up.json`, `forCoys` in `PlanRecipes.Recipe` |
| Recipe `forCoys` (3): the Coys the layout is for, checked against the slots; a family may hold a layout once for each Coy count. The tab shows the layouts for the type chosen (Lt Cdo: Auto, Two up, Three up; others: the 4-Coy set), Auto and Compare rank only those; picking a type switches the layout. A Bn type is offered where the family has a layout for its Coys: Lt Cdo on Bn Def, still not on Bn Attk or Bn Crossing (4 only) | `PlanBuildTab._famIds`, `_famNeeds`, `_needOf`, `_unitTypeRow` |
| **AT group** (Bn Def only; row under Type): the ATGM Coys of an AT Bn (LAT APC borne, LAT Jeep borne, HAT: 3 ATGM Coys of 12 launchers each, the Bn's 36 shared over 3) grouped to the Bn, 1 to 3 of them. Their launchers join the unit's own (Std Inf Bn + 1 LAT Coy: 4 + 12 = 16 ATGM, 8 pairs, 970 all ranks): 7 pairs sited on the tank approaches where there were 1, those landing on one approach fanned out 3 pairs' width apart (E), and the AT cover row says "holds 16 ATGM (8 pairs)". The unit's rifle Coys, strength of the reserve and mounted flag are unchanged; the unit line and Copy as Text name the group | `PlanOrbat.ownAtTypes`, `withAtGroup`, `PlanFit.atgmExtras`, `PlanBuildTab._atRow`, `_atGrouped` |
| A built plan carries the group (`pbMeta.atGroup`) and Check my plan reads it back: its AT cover counts the grouped launchers, its force row names the unit as built | `PlanBuildTab._meta`, `PlanCheck` |
| Checks | `node tools/planbuilder-test/orbat.mjs` (73), `recipes.mjs` (113), `check.mjs` (101), `solve.mjs` (475, over 26 recipes) |

Verified in the app (dev server, terrain ready): Bn Def with the Lt Cdo Bn (28 symbols two up, 34 three up; Check rows pass for frontage, depth and reserve reach), back to the Std Inf Bn (the 4-Coy layouts return); LAT Coys 1 and 2 grouped (970 and 1,131 all ranks, 12 and 24 ATGM); a HAT Coy grouped with a mech enemy (Copy as Text names it); Coy Def, Bn Attk with the Lt Cdo chosen (not offered on the attack). **Not checked in the app:** placing a plan with the group and Check my plan on it (the map did not take clicks in that run); that read-back is tested in Node (`check.mjs`).

**More of the ORBAT, step 3 (19 Nov 2026, the user: "Armour next"): the tank Sqn and the armoured formations:**

| Piece | Where |
|---|---|
| **The tank Sqn with an attack from the Armr Regt** (`armr-sqn-tk`, p 107-108, 111): 14 tanks (SHQ 2 + 4 Tps of 3), from an Armr Regt of 44. The tank recipe carries it (`Recipe.tankSqn`); the timing rows say "the Sqn of 14 tanks" (Fire sp) and "the Sqn (-), 11 of its 14 tanks," (Close sp: the Tp of 3 stays on the BOF's flank); a line under the Tanks chips and Copy as Text name it. Without the armour file the wording and figures are as before | `PlanOrbat.tankSqnOf`, `tankSqnText`, `PlanTanks.withTanks`, `addTankTimes` |
| **Force ratio counts the Sqn** as one more manoeuvre unit (a Bn of 4 Coys on an en Coy: 4 : 1, with the Sqn 5 : 1; the unit named "4 rifle Coys + 1 Tk Sqn of 14 tanks"). Armour weighs more than a Coy: one is a floor (E) | `forceFromOrbat`, `PlanBuildTab._force` |
| **IABG** in the Bde Type row (3 Armr Regts + a MIB, 13 manoeuvre Coys / Sqns, 107 APCs, mounted) and a **Div Type row** (Inf Div, Armd Div: 13,128 all ranks), on the crossings (a Bde or Div plan). As in step 1 the choice changes what the tab shows and the unit Check my plan reads: the crossing times take no unit | `ownBdeTypes`, `ownDivTypes`, `unitForPlan` (`div`), `_divId` |
| Fixed on the way: the Armd Div's Coy count was 39, because its Armd Bdes, printed with no contents, were counted as 12 Coys each on top of the Regts that make them up; now 27 (5 Armr Regts x 3 Sqns + 3 MIBs x 4). The enemy's Divs are unchanged | `coysOf` |
| Checks | `node tools/planbuilder-test/orbat.mjs` (88) |

Verified in the app (dev server): Bn Attk with Close sp and Fire sp (the line under the chips, Force ratio about 5 : 1, Tank timing with the Sqn's tanks, Copy as Text); Bde Crossing with the IABG; Div Bridgehead with the Armd Div. **Data gap, not filled:** main gun ranges are printed for 1 of the 13 tank guns in `weapons.json` (the Al-Zarrar, effective 2.5-3 km); the other 12 have none, so the Tank fire range row keeps the doctrine's night 800 / 1600 m (IBB p214) and the tanks are not counted as AT weapons in the AT cover row. They have to be read from the handbook first; I did not invent them.

**Armour in defence (19 Nov 2026, the user: "Armour in defence"): tank Sqns grouped to a Bn defence:**

| Piece | Where |
|---|---|
| **Tanks row on a Bn Def** (None, 1, 2 or 3 Sqns of the Armr Regt, 14 tanks each, ORBAT): each Sqn a tank unit symbol (A, B, C Sqn) in its harbour **beside the reserve**, 1100 m off its centre, alternate sides; in a layout with no reserve (the 3-Coy three up) 500 m behind the rear edge of the forward Coys. A new recipe per choice (`-tkd1`...), the base one unchanged; works with the 3-Coy layouts too | `PlanTanks.withDefTanks`, `Recipe.defTanks`, `PlanBuildTab._tankRow`, `_rcp` |
| **The Sqns are the C Pen force at the tank rate**: each Sqn's move to the C Pen posn on the main approach on tracks (24 km/h, tracked going) in the trigger table and the Moves in time row, timed against the enemy like the reserve's (the Sqn 11 min against the reserve Coy's 38 on foot in the test; the same 30 min wanted). A layout with no reserve gets its C Pen posn from the Sqn alone | `PlanWhatIf.whatIf` step 3 |
| **Tank harbour row** on the ground: tracks go there (not NO-GO: fail), and it is not in his view from where he starts (a hull 2.3 m up: 50 % or more seen warns, hull down or move it). Without the ground one **Tank Sqns** row, not checked | `PlanTanks.defTankRows`, `PlanFit.fitLayout`, `PlanCheck` |
| **The force counts each Sqn** as one more manoeuvre unit ("4 rifle Coys + 2 Tk Sqns of 14 tanks": 6 against 4); a built plan carries `pbMeta.defTanks` and Check my plan reads it back: the Sqn symbols are not taken for held posns, their harbour and C Pen move are read from the symbols, the force names them | `forceFromOrbat(…, nSqn)`, `PlanBuildTab._meta`, `PlanCheck` |
| *(superseded the same day, see "Limits overcome" below: the tanks' guns now count as AT, at an E figure.)* | |

**Armour in defence, limits overcome (19 Nov 2026, the user: "overcome limits"):**

| Limit | What was done |
|---|---|
| Main approach only | The first tank unit (A) is also timed to the **Sup posn of each secondary approach** (trigger `tk-sup-<approach>`, "Enemy on A2 (secondary): A Sqn -> Sup 1"), on tracks, against his time there. The other units stay for the main approach. `PlanWhatIf.whatIf` step 2 |
| Tank guns not counted as AT (ranges printed for 1 of 13 tanks) | The Al-Zarrar's printed effective range, **2500 m**, is applied to the grouped tanks as **`atFramework.tankGunEffM` (basis E)** in `PlanDoctrine.json`, with its source and a note to change it for another tank. A **Tank AT cover** row: for each approach, how far beyond the FDL its path stays within that range of the posn the tanks fire from (the C Pen posn on the main approach, the Sup posn on a secondary one); covered when 500 m or more (`atFramework.tankCoverMinM`, E). E.g. A1 1800 m, A2 800 m beyond the FDL. Warns for an approach out of reach or no posn. Check my plan reads it back. A shorter gun (300 m) leaves the approaches short and warns. **The 12 other tanks' real ranges are still not read**: see below. `PlanWhatIf.tankCoverRow` |
| Tanks in a Coy defence | **Tank Tps** (3 tanks, the ORBAT's AFV Tp) on a Coy Def: Tanks row None / 1-3 Tps; harbours beside the reserve Pl (650 m off its centre: half its width and 350 m); the C Pen force at tank rate; Tank harbour / Tank AT cover rows; each Tp a third of a Coy in the force ("Rifle Coy + 2 Tk Tps of 3 tanks": 1.67). The count resets when the operation or unit changes (Sqns for a Bn, Tps for a Coy). `withDefTanks` (echelon 15), `Recipe.defTanksUnit`, `forceFromOrbat(…, tp)` |
| Checks | `tanks.mjs` (86), `check.mjs` (108) |

**The handbook re-read (19 Nov 2026):** the user unlocked `Sec 1 - Armr.pdf` with their password into `Material/unlocked/` (poppler `pdftocairo -upw`, typed by them; not stored). Sec 1 has text. Findings:
- **No gun ranges to fill.** Pp 121-124 (Comparative Data Current MBTs) print, for M1A2, T-72, T-55, Vijayanta, Merkava Mk2, T-85 IIAP, MBT 90, T-69 MII, T-59 M, Leopard II, Al-Khalid and T-80 UD: calibre, ammo, rounds carried, night vision, LRF, and an *Op Range* in km (how far the tank drives), but **no gun range**. Only the Al-Zarrar's essential data (pp 124-126) prints one: eff 2500-3000 m, max 12220 m. So the gap is the book's; `weapons.json` stays as extracted and `tankGunEffM` stays E (its note now says so).
- **No armour frontages or depths** anywhere in Sec 1 (orgs, echelons, radio, ammo, space / mov / log, the CCO layout), so an Armr Regt or Tk Sqn as the unit of a plan still has no figures from it.
- **IC s105 para 21c (p 555), text in `Material/IC.pdf`:** tanks in defence *mount counter-attacks, counter enemy penetration, and destroy his armour by offensive action while lending weight to the AT layout only where absolutely inescapable*. That is how the Tanks row uses them (C Pen force, not posted as AT); the Tank AT cover row now cites it and says the reach is from where they go, not a post. Para 22: a Tp of tanks lifts a Pl.
- `IBB.pdf` is scanned (no text); `Operations of War (Volume-I) Defence.pdf` is password-protected too: it may hold armour frontages in defence.

Also not done: the Recce Regt / Sqn for screens; tanks as a reserve in an attack's follow-up phase.

**Artillery with a Bn plan (19 Nov 2026, the user: "Commit, then artillery"):**

| Piece | Where |
|---|---|
| **Arty row** on a Bn Def or Bn Attk: None, or a Regt / Bty from the ORBAT with its gun and planning range (90 % of max, Sec 2 p 212): Fd Regt 18 x 122 mm How 10.6 km, Med Regt 18 x 155 mm How 13.1 km, Med Regt (SP) 18 x M109 14.9 km, Hy Regt 12 x 155 mm Gun 21.2 km, Mtn Regt 12 x 105 mm Pack How 9.0 km, and their Btys. Not offered: the rockets (MLRS, 40 km minimum; the MBRL Bty, general support), the 8 in (no weapon linked), the locating units | `PlanArty.ownArtyTypes`, `PlanBuildTab._artyRow` |
| **Its gun area** (PAA, 2525D `25240501`), sized and placed by the Gun Deployment doctrine (`GunDoctrine.json` through `gunRulesFrom`): a Regt 1000 x 1000 m (R, p 225), a Bty 400 x 200 m (U, FM 6-50); its front edge in the middle of the band behind the front: in defence at least 2 km behind the FDL (E), in an attack 1 km behind the FUP (U), at most a third of the planning range (R, SZ p 24). Defence: on the plan's axis (the Fd Regt's 2.8 km behind the FDL); attack: 1500 m beside the axis, clear of the Assy Area. A new recipe (`-gun`) laid last, on top of tanks, two phases or a 3-Coy layout | `PlanArty.withArty`, `artyOnPlan`, `PlanBuildTab._rcp` / `_rcpBase` |
| **Arty reach**: how far behind the front it stands (the band: too near, he overruns it early, OoW I p 70; too far, the fire does not reach deep; a gun too short for any band says so), how far its guns reach beyond the FDL, his FUP for his type (2.5 km tanks) and the DF Tgts in range (Fd Regt: 7.3 km beyond, 9 of 9). Attack: the Obj, Obj 2 and the LOE in range, else fail | `PlanArty.artyRows` |
| **Gun area** on the ground: the share of it a gun position may take, on the bundle's own Gun Position going (`rules.json` profiles.gun: water, marsh, built-up, too steep), against GunDoctrine room (90 % wanted, under 70 % the guns cannot keep 100 m apart: fail). Level, crest, firm soil, access and concealment are left to the Gun Deployment tool, and the row says so. The ground reader now gives the `gun` going too | `artyRows`, `PlanGroundProbe.going`, `PlanFit` |
| Check my plan reads the artillery back (`pbMeta.arty`): its gun area, the FDL and the DF Tgts from their symbols, the same rows and verdicts as the build (defence) | `PlanCheck` |
| Copy as Text: an `Arty:` line under the unit | `PlanBuildTab._unitLine` |
| Checks | `node tools/planbuilder-test/arty.mjs` (27) |

Verified in the app: Bn Def with the Fd Regt (33 symbols; Arty reach pass; Copy as Text), with a tank Sqn and the Med Bty (SP) together (34), Bn Attk with the Med Regt (Arty reach: the Obj and LOE in range, 2.7 km behind the FUP); the Arty row is not on a Coy Def. Not checked in the app: the Gun area row on real terrain (tested in Node on synthetic ground).

Verified on the real terrain east of Lahore (19 Nov 2026, threat marked east): a Bn Def two up with a tank Sqn and the Fd Regt placed: Tank harbour pass (tracks go, hidden), Gun area 92 % usable (pass), Arty reach pass, Tank AT cover 1740 m beyond the FDL, the A Sqn to the C Pen posn in 11 min against his 25 (the reserve Coy on foot 58: too late); Check my plan on the placed plan read every row back the same. It found a bug, fixed: the fitted plan showed Arty reach and Tank Sqns twice.

Not done: siting the gun area with the Gun Deployment tool's own finder from the plan (it is in `GunDeployment.ts`, which another session is changing now); artillery in Check my plan for an attack; the fire plan (the guns' DF Tgts and the fire lifts by the Regt's own guns, as the attack's H-hour sum already lifts by calibre); artillery for Bde and Div plans.

**Engineers (19 Nov 2026, the user: "house keeping and the engineers"):**

| Piece | Where |
|---|---|
| **Engrs row** on a Bn or Coy Def and on the crossings: Doctrine (as before: one Fd Coy for the minefield, Annex Q for the crossing), or an ORBAT unit with its laying Pls and equipment: Fd Coy 3 Pls; IFCE 3; IMCE 2, 3 AVLB; Def Div Engr Bn 9 Pls, 9 MML (p 404); Offn Div Engr Bn 9 Pls, 6 MML, 5 TAM, 5 MICLIC, 1 AM-50 (p 402); Mech Engr Bn 4 Pls, 4 MML, 6 AVLB; Aslt Engr Bn 9 Pls, 15 TAM, 9 AVLB, 3 AM-50 (p 408); Br Bn 2 ribbon bridge, 4 AM-50 sets, no laying Pls (p 412) | `PlanEngr.ownEngrTypes`, `PlanBuildTab._engrRow` |
| **Mines in time** with them: by hand at 780 mixed clusters a Pl in 24 h (p 439), and with a set of 6 MMLs laying ATMs alongside (9000 m in 24 h a set: ideal conditions, figures under trial, p 439; the machine's metres counted as metres of front, E). Def Engr Bn on 3.5 km: 12 h by hand, about 5 h with its MMLs; 12 km: 41 h by hand (over the 36 h), 18 h with them. A unit with no laying Pls (Br Bn) warns; short of a set of 6 MMLs is said. Check my plan reads the unit back (`pbMeta.engr`) | `PlanOrbat.minefieldRow(…, engr)`, `PlanEngr.minesByEngr`, `PlanCheck` |
| **Engr bridging** on a crossing (on the ground, beside Annex Q's M2 Bridge row): the fastest of what the unit holds that spans the gap and its seats: the AVLB (Pak, T-59, 18 m, 3 min, p 432), AM-50 sets (54 m, 1 h 45 / 1 h / 1 h 15 by light as printed) or ribbon bridge sets (100 m, Cl 60: the US figures 1 h / 1 h 15 / 1 h 30, the chart not saying which make: the slower taken, E), sets end to end built one after the other (E); on the timeline. The test canal (70 m): the Br Bn's ribbon bridge open H+1 h 30 on a dark night against the M2's H+3:45; the Aslt Engr Bn two AM-50 sets H+2 h 30. Longer than it holds: warn | `PlanEngr.engrBridge`, `bridgeKinds`, `PlanCrossing` |
| **Mech breach** with his minefield (the Mf chip): a TAM to each lane (one lane a crossing place), about depth / 300 m an hour (p 451: a 600 m lane 2 h, 900 m 3 h, 1 Pl, 5 m wide; **the print's columns are uncertain**, read so) against Annex Q's hand breach; short of TAMs warns; its MICLIC named; on the timeline | `PlanEngr.tamBreach`, `PlanCrossing` |
| Checks | `node tools/planbuilder-test/engr.mjs` (22), `crossing.mjs` (63) |

Verified in the app: the Engrs row on Bn Def (Def Engr Bn: Mines in time 12 h by hand, 5 h with the MMLs), Coy Def, Bn Crossing (one row) and Bde Crossing.

Not done: engineers on an attack (the breach of his minefield in front of a Bn Attk: the attack has no minefield yet); the hand-breaching table of p 450 (by depth in yards, the Pls and times by light: Annex Q's figure is kept); rafts from the engineers' table (p 430-431); obstacles other than mines (the AT ditch, wire, demolitions); the Div's Engr Bn's Coys split between Bns.

**The not-done items, done (19 Nov 2026, the user: "complete what is not done"):**

| Item | What was done | Where |
|---|---|---|
| Artillery in Check my plan for an attack | The built gun area, FUP, Obj, Obj 2 and LOE read from their symbols (metres from the FUP toward the Obj): Arty reach as the build gave it | `PlanCheck.checkAttack` |
| The fire plan by the plan's own guns | The assault is timed to the lifts of the fire the plan has (IC s66 p305): without artillery every ring (120 mm 450, Med 360, Bn Mor 275, Fd 180); with it the Bn's mortars and the Regt's own ring (Fd / Mtn 180, Med / Hy 360). The SL finder holds the SL beyond the furthest of those | `PlanAttack.liftRings` |
| 3-Coy layouts for Bn Attk | `bn3-attk-right-flank`, `-left-flank`, `-frontal` (Lt Cdo): A, B Coys assault, C Coy the reserve, the BOF the support weapons (no Coy); one phase only (the Phases 2 chip off: no Coy left for it). The validator counts an attack's Coy symbols for `forCoys` | `Recipes/bn3-attk-*.json`, `PlanRecipes.validateRecipe`, `PlanBuildTab._rcpBase` |
| AT groups by Pl | A Coy Def takes 1-2 ATGM Pls of an AT Bn's Coy (6 launchers each, the Coy's 12 over its 2 Pls; 32 all ranks): 3 pairs sited on the tank approaches for one Pl; read back by Check my plan | `PlanOrbat.withAtGroup(…, byPl)`, `ownAtTypes` (`plsPerCoy`, `launchersPerPl`) |
| Engineers on an attack | **His Mf** row on a Bn Attk: his protective minefield about 200 m in front of the Obj, 250-300 m deep (IC s111.5, s107), across the axis where it enters the Obj (frontal and flank), hostile, a Breach lane for each assault Coy (`-amf`). **Breach** row: Annex Q (3 Pls a lane, 4 / 6 h), the **p 450 hand-breaching table** (by depth in yards: 360 yd, 2 Pls, 4 h 8 min by day), the engineers chosen (Engrs row): their Pls at once or in turns, their TAMs (p 451); the H-hour sum gets "Engineers begin the lanes" that long before H | `PlanAttack.withAttackMinefield`, `attackBreach` |
| Engineer rafts | The Br Bn's ribbon bays as rafts on a crossing (p 430-431): the Chinese 3-bay Cl 60 raft (the US one prints no class: the make is not on the chart, E), built 10 / 15 / 20 min, 5 / 4 / 3 trips an hour by width: first tank H+26 min, a Sqn H+3 h 8 on the test canal by dark night, on the timeline | `PlanEngr.engrRafts`, `bridgeKinds().rafts` |
| Tanks as the reserve in phase 2 | Two phases by C, D Coys leave no infantry reserve: with tanks the Sqn, its part in phase 1 done, is the reserve behind Obj 1 (IC s105 para 21 b; E: Reserve row pass, tell Bde all the same); without tanks the row says so | `PlanSolve` (Reserve row) |
| Recce Sqn for screens | **Screen by**: Rifle Coy or Recce Sqn (p 109-112: 11 tanks, 3 AFV Tps, 2 Rifle Tps in 8 APCs). The posts are its AFV Tps (tank symbols) seeing from the cupola (`smallOps.screen.tankEyeM` 2.5 m, E) | `PlanSmallOps.withRecceScreen`, `PlanOrbat.recceSqnOf` |
| Fixed on the way | `baseId` had lost the backslash in `-tkd\d` (a defence with tanks could lose its family's unit) | `PlanBuildTab` |
| Checks | `arty.mjs` 33, `orbat.mjs` 93, `engr.mjs` 34, `crossing.mjs` 64, `tanks.mjs` 91, `recipes.mjs` 121, `solve.mjs` 547 (29 recipes) | |

Verified in the app: Bn Attk with the Lt Cdo Bn (the 3-Coy layouts, Phases 2 off), His Mf with the Aslt Engr Bn (Breach pass by TAM, 17 symbols), Coy Def with a LAT ATGM Pl (6 ATGM, 173 all ranks), Coy Screen by the Recce Sqn.

**Still not done, and why:**
- **Siting the gun area with the Gun Deployment finder**: `GunDeployment.ts` is being changed by another session now, and its finder reads a different ground reader (the Site Scan probe): left so as not to collide.
- **Artillery for Bde and Div plans**: the only Bde and Div plans are the crossings, whose times take no unit; a gun area there needs a fire plan for a bridgehead first.
- **AD and aviation as units in a plan**: new arms with their own doctrine (AD sites over the bridge, gun area, HQ; the Air Aslt Bn's lift), not started.
- **An Armr Regt or Tk Sqn as the unit of a plan**: needs armour frontages and depths; Sec 1 has none; `Operations of War (Volume-I) Defence.pdf` may, but it is password-protected (the user can unlock it as Sec 1 was).
- **SSG and Coast Guards in the Type row**: the user's call.
- **Obstacles other than mines** (AT ditch, wire, demolitions) and **the Div Engr Bn's Coys split between Bns**: not started.

**The open items closed (19 Nov 2026, the user: "commit and close all open issues"):**

| Item | What was done | Where |
|---|---|---|
| SSG and Coast Guards in the Type row | Offered as any Bn type (16 types); the SSG (Mtn) has no rifle Pl, so it is not offered for a Pl plan | `PlanOrbat.ownBnTypes` |
| The Div Engr Bn's Coys split between Bns | **Engr Coys** chips under an Engr Bn (All, 1 Coy, 2 Coys ...): its Pls and Coys in proportion, its MMLs up to a set of 6 a Coy, the rest pro rata (floor); Mines in time, bridging and the breach use the share; Check my plan reads it back | `PlanEngr.engrShare`, `PlanBuildTab._engrCoys`, `PlanCheck` |
| Artillery on Bde and Div crossings | A Bn or Bde crossing takes a Regt or Bty, a Div bridgehead a **Div Arty** (Inf Div Arty: 2 Fd + 2 Med Regts; Armd Div Arty: 3 Med (SP) + 1 Med Regt; Sec 2 pp 202-203), one gun area a Regt (`gunArea`, `gunArea2` ...). Each in the middle of its band (a crossing is an attack: from 1 km) behind the FUPs, slid across and within the band to the nearest place 100 m clear of the FUPs, Assy areas, BOFs, HQ, waiting Bns and Bdes and each other. **Arty reach**: every Regt must reach the break-in (Objs, PL 1); the deep line (Obj 3, PL 2, BH) wants one (Bde: the Fd Regt 2.3 km back reaches the BH; Div: the Fd Regts fall short of the 6 km BH, the Med Regts reach it). **Gun area** on the ground, laid along the canal; Check my plan reads both back | `PlanArty.ownDivArties`, `withArty` (crossing), `crossArtyRows`, `PlanCrossing.readCrossing` |
| AD over vulnerable points | **AD** row: an AD Bty (Bn, Bde plans) or Regt (Div) from `ad.json`, broken into its fire units (Gun Tps, Msl Tps, FUs) with their weapons' max eff slant range (p 317: 37 mm 3.5 km, 35 mm 4 km, 57 mm 6 km, RBS-70 5 km, Bolide 8 km; the Tps' unnamed SAM Launcher taken as the Anza Mk II 5 km, E). The VPs in priority: bridges and gun areas, the HQ, the Assy areas and the reserve; one FU each in turn, a quarter of its range out (300-1000 m, E), forward left and right first. **AD cover**: the FUs that engage 1.5 km beyond each VP (E); fail when a bridge or gun area has none, warn under 2 (E). A Bde with a Bty passes; a Div bridgehead with an RCG Bty (2 Tps) fails. Figures in `PlanDoctrine.ad` | `PlanAD.ts`, `PlanFit`, `PlanCrossing`, `PlanCheck` |
| Aviation lift for the Air Aslt Bn | **Air lift** on an attack by the Air Aslt Bn: the Air Aslt Sqn (p 703: 2 Flts x 6 Air Aslt Hels, the Bell 412, the only Air Aslt type, 9 troops, 220 km/h; a Cargo Sp Flt of 5, type not fixed: Bell 412 taken, E) = 153 a wave; the Bn HQ, 4 STCs and Cbt Sp Coy (731) in 5 waves; 24 min a round trip at 25 km PZ-LZ with 10 min on the ground (E): complete 1.6 h after the first wave (2 h allowed, E); warns beyond it or when the first wave is less than an STC. Figures in `PlanDoctrine.airAslt` | `PlanAvn.ts`, `PlanBuildTab._liftRows`, `PlanCheck` |
| Obstacles other than mines | **Inundate** on a Bn defence (300 / 500 / 1000 yd, Water 150 / 100 / 50 cusecs, Soil): an Obstacle Zone labelled Inundation beyond the minefield (no flooded-area symbol in the catalogue), and **Inundation** timed from engr table 20 (pp 452-453): compartments of 1000 yd built by 4 Pls and 4 dozers each (8 / 10 / 14 days, half a day off a common dyke), filled one after another, the soil saturated to 2.5 ft; 2-4 days to saturate is what the book calls suitable (quicker: warn, slower: fail). Not judged against a time (the warning time is the commander's). Wire, AT ditches and demolitions: no rates in the ORBAT, said so in the row | `PlanEngr.inundation`, `withInundation` |
| Siting the gun area with the Gun Deployment finder | **G** while a Bn defence or attack with artillery rests: `GunDeploymentFind.findGunAreas` on its own `SiteBundle` round the plan's gun area (the band's spread), the target the Obj or his FUP on the axis, the front the FDL or the SL; the gun area moved to the best site and the plan refitted, so Arty reach and Gun area judge it there; **Gun site** row with the finder's verdict and readings; Shift+G takes it back. `GunDeployment.ts` not touched. A crossing's gun areas stay where laid | `PlanBuildTab._siteGuns` |
| Checks | `ad.mjs` 21 (new), `avn.mjs` 10 (new), `arty.mjs` 41, `engr.mjs` 49, `crossing.mjs` 70, `orbat.mjs` 93; the rest unchanged and passing | |

Verified in the app: the Bde crossing's Arty and AD rows (Fd Regt, Lt AD (GM) Bty: Arty reach and AD cover pass), the Div bridgehead's Div Arties and AD Regts (four Regts read), the Bn defence's Inundate / Water / Soil chips and the Inundation row, the Air Aslt Bn's Air lift row; on the real ground east of Lahore a Bn defence with the Fd Regt, G: the gun area 1.7 km left to the finder's best (room 100 %, level, firm, access 170 m to a Cl 40 road, crest clear; BUA near: warn), Arty reach still passing 2.1 km behind the FDL.

**Armour as the unit of a defence (19 Nov 2026, OoW Vol I read unlocked, then the copy deleted):** Vol I prints no frontage or depth for an armour unit holding ground. Its doctrine (s6 para 1 p 22): armour is employed concentrated, the main element of the reserve, in recce, covering troops and advance posns, the nucleus of the counter-attack, part of a strong point, supplementing the AT defence; within the main defences only by exception. So an Armr Regt or Tk Sqn is **not** offered as the unit of a defence layout: armour joins a Bn defence as its tank Sqns (C Pen force, AT weight), as built. Recorded as `atFramework.armourInDefence` (D) and cited in the Tanks row and Tank AT cover. Vol I's only frontages are an Inf Div's (diagrams pp 104-106: 10-12 km by 4-8 km, "a guideline"). **Armour in the attack (OoW Vol II read unlocked the same day, then the copy deleted):** no frontage or depth for an armour unit either: frontages "depend on defender's dispositions and lie of terrain" (narrower by night, s9 p 37) and the attack's distances "depend upon the terrain and en strength" (Fig 7). What it gives (`atFramework.armourInAttack`, D): Combat Command = Bde group, Combat Group = Bn / Regt group, Combat Team = Sqn / Coy group, armour or infantry heavy by terrain (armour heavy in semi desert and desert, with a favourable air situation; s7 paras 20-22); the Armd Div after a break-out on a broad front with two Bdes, each two Regt groups up or one (p 53); Fig 2, an Armd Bde leading an Armd Div's advance (covering troops 4-8 km ahead, Van Gd about 3500 m, flank guards about 6 km out, main body about 8 km behind, 15-20 km for the Armd Div; the scan is highlighted over, so uncertain). The Bn Attk's tank Sqn (fire / close sp, armour heavy or infantry heavy) already follows these groupings; an Armr Regt is not offered as the unit of an attack layout, whose frontages are infantry rows.

**Then still open:** G on a crossing's gun areas (the crossing re-lays its slots along the water and takes no moves).

**What was left, done (19 Nov 2026, the user: "what is left? lets do it"):**

| Item | What was done | Where |
|---|---|---|
| Tanks to the secondary approaches' Sup posns | Already built (the first tank Sqn's switch to each Sup posn, `tk-sup-` triggers, timed against him); the "not done" line was stale | `PlanWhatIf` |
| AT group on a Bn attack | The AT row on a Bn Attk; **AT on the Obj**: the unit's ATGMs (its own and the AT Coys grouped) brought onto the last objective as it is reorganised, a pair on its edge facing each of his counter-attack ways in, `atgmDetSpacingM` apart (IBB p 189 paras 22-23, p 191); each way in judged for the pair's reach to its DF point and how much of the last stretch is in view; fewer pairs than ways in warns. The Std Inf Bn's 4 BS give 2 pairs for 3 ways (warn); with 2 LAT Coys every way is covered (pass) | `PlanAttack.atOnObj`, `PlanFit`, `PlanBuildTab._atRow` / `_atGrouped` |
| 3-Coy Bn crossing | `bn3-cross-two-up` for the Lt Cdo Bn: A, B assault, C passes through to OBJ 2, no Coy left for a reserve (the Bde's or the follow-up Bn's, E). The validator counts a crossing's Coy points for `forCoys` | `Recipes/bn3-cross-two-up.json`, `PlanRecipes.validateRecipe` |
| G on a crossing's gun areas | G sites every gun area on the plan in turn (a Div bridgehead's four, each with its own gun); on a crossing the target is the bridgehead line, the front the water line; the crossing reader lays G's move over each re-laid gun area; one Gun site row for all; Shift+G takes them all back. The G key now reaches crossings | `PlanBuildTab._siteGuns`, `PlanCrossing.readCrossing` |
| Found on the way: Arty reach on a crossing | It measured "behind the FUPs" along the aim; a crossing is re-laid along the water, so an aim off square to the water (a diagonal drain) understated it. It now measures behind the water in the obstacle's frame | `PlanArty.crossArtyRows` (`backOf`) |
| Found on the way: Check my plan re-read | When tiles arrived after a check, it re-ran the defence / attack reader whatever the plan, so a crossing, ambush, patrol, recce or advance checked while tiles loaded came back read as an attack. It now re-reads it with its own rows | `PlanBuildTab._onGroundChanged` |
| Checks | `attack.mjs` 46, `crossing.mjs` 74, `recipes.mjs` 125 (31 recipes), `solve.mjs` 583 | |

Verified in the app: the Lt Cdo Bn offered on a Bn crossing, the AT row on a Bn Attk, G on a Bde crossing on the Hadiara Drain east of Lahore (the Fd Regt's gun area to the finder's best site, score 98 %, Gun site row). Not verified in the app (the browser pane went hidden): the crossing's Arty reach after the obstacle-frame fix, Check my plan's re-read fix, the advance's report-line choice; each is checked in Node.

**The user's figures (19 Nov 2026, "yes, ask me"):** confirmed as they stood and recorded as basis U: AD `releaseM` 1.5 km, `minFus` 2, `siteM` 300-1000 m, the SAM Launcher as the Anza Mk II; air lift `pzLzKm` 25 km, `groundMin` 10 min, `buildUpMaxH` 2 h, the Cargo Flt as the Bell 412; `atFramework.tankGunEffM` 2500 m and `tankCoverMinM` 500 m; new doctrine figures for what was in the code: `advance.haShortOfRlM` 1 km, `advance.haSizeM` 600 x 400 m, `inundation.soilDefault` loam. The rows no longer call these E. About 140 older E figures remain in PlanDoctrine.json (frontages, moves, the attack finders), not asked this time.

**Still open:** the follow-up Bde's lower figure (hidden in the scan); ORBAT data gaps that need the books (224 of 308 inf.json child links carry a role and no unit id; the Armd Div's Bdes have no contents in armr.json; 1 of 13 tank guns has a range); the E figures for AD, the air lift and inundation, the user's to set.

**Advance to contact (19 Nov 2026, the user: "build it"):** a new operation, **Advance**, family Armd Bde Advance (`bde-advance-armd`, unit the IABG): the click is the SP (the Van Gd's head crosses it first), the aim the direction of advance. Laid from OoW Vol II Fig 2 (`PlanDoctrine.advance`, D, uncertain: the scan is highlighted over): C Tps 6 km ahead (4-8), flank guards 6 km out, the Advance Guard an Armr Regt group (Van Gd about 3.5 km deep, Main Gd about 3 km behind it, a line marking its end), the Main Body 8 km back (15-20 km for the Armd Div), the axis from the Main Body to the C Tps. Rows: **Covering troops**, **Advance Guard**, **Main Body**, **Flank guards** (warn a quarter off Fig 2, E); on the ground **Going on the axis** (the bundle's tracked going in 20 m steps: NO-GO share over 10 % or a stretch over 200 m warns, over 500 m fails, E) and **Flank guards' ground** (NO-GO warns, SLOW-GO named). Check my plan reads it as drawn (the axis from the SP toward the C Tps). `PlanAdvance.ts` (`advanceRows`, `advanceGroundRows`, `fitAdvance`, `checkAdvance`), `PlanFit.fitLayout`, `PlanSolve` (its own grey rows), the tab (`_isAdvance`); `node tools/planbuilder-test/advance.mjs` (15). Verified in the app: east of Lahore aimed 090, 9 symbols, all rows pass (a 60 m canal on the axis 2.8 km behind the head; the left flank guard in built-up ground), Check my plan the same. Not done then: the route, bounds and report lines.

**The advance's limits worked (19 Nov 2026, the user: "work on limits"):** with the ground the axis is now **routed for tracks** (`routeAxis`: PlanGround.avenues, the least-cost way over the bundle's going, NO-GO avoided and SLOW-GO dear, the Main Body to the SP and the SP to the C Tps; straight where none is found), the arrow drawn along it (simplified within 25 m, its head 300 m past the C Tps). New rows: **Axis route** (its length against the straight line, warn over 1.5 times, E; the share on roads and their classes from the bundle: Cl 60+, Cl 50-59, below Cl 50, not recorded, unmetalled); **Crossings on the axis** (each water feature crossed and how, from the bundle's bridge classes: a Cl 60+ bridge passes, Cl 50-59 or unrecorded or a ford warns, below Cl 50 / railway / foot bridge or no bridge fails; the water under a bridge looked for 150 m either side, a bridge within 60 m of the line taken as the one used); **Report lines** (RL 1-4, slots placed only on the ground, laid across the axis on the canals, distributaries, streams and bridges ahead of the SP, at least 1 km apart, E; the bounds between them; none: set by eye). Check my plan reads the drawn arrow up to the C Tps and the drawn report lines along it. `advance.mjs` 30. Verified in the app east of Lahore aimed 090: the route 16.0 km against 14.0 km straight, 60 % on roads; a canal 3.5 km behind the SP and a bridge 6.3 km ahead, both of unrecorded class (warn: recce before the tanks); RL 1 on that bridge; Check my plan gave the same verdicts (its RL distance fix is checked in Node, not re-run in the app). Then still not done: the march table, timings and halting areas (the Move Planner's); the Fig 2 figures stay uncertain until a clearer copy is read; the E thresholds are the user's to set.

**Closed (19 Nov 2026, the user: "close them"):** **March** row: the Move Planner's road engine (`MoveRoad.simulate`, `legsOf` rules, MoveDoctrine road: speeds for columns with tanks on good roads 25 / 20 km/h, 20 / 40 vehicles a km, halts 10 min after 110 min) runs the Adv Gd (the Armr Regt's 116 vehicles) from the SP at H and the Main Body (the IABG less a Regt: 510 vehicles counted; the units with no vehicle total named) from 8 km back, and gives each its column length, time past a point, when its head reaches the SP, each report line and the C Tps' line, its tail clear, its halts; warn when the Adv Gd as one road column (10.0 km at the road density) is longer than the 8 km to the Main Body's head, or a serial runs past last (first) light. **Halting areas** HA 1-4 for the Main Body 1 km short of each report line beside the axis (600 x 400 m, E). The user's settings: **RL apart** 1 / 2 / 3 km (default 1) and **H** first light / last light / now (default first light) as chips on the advance (`Recipe.advance`); the NO-GO limits (200 / 500 m, 10 %) and the 1.5 times detour kept and recorded as the user's (basis U). `advance.mjs` 41.

**Fig 2 re-read (19 Nov 2026, Vol II unlocked again, the copy deleted after):** the highlights are part of the page, not annotations, but the text under them is in the page's text layer; each figure placed by where it stands on the page (`pdftotext -bbox`). Two earlier readings were wrong and are corrected: the **Main Body** follows straight behind the Advance Guard (its bracket begins where the ADV GD bracket ends: head 6.5 km back) and is **6 km deep** ('6 Kilometers' beside its bracket), not 8 km back; the **flank guards** are the Armd Div's, **15-20 km out** (the box reads 'FLANK GD (15-20 Km for the Armoured Division)'), not 6 km. The '8 Km' is the Note's follow-up Bde ('...-8 Km behind the ldg bde', its lower figure hidden). Confirmed: C Tps 4-8 km ahead, Van Gd 3500 m, Main Gd 3000 m; '300-500 m' is a frontage across the head. `PlanDoctrine.advance` now cites each (basis D, no longer uncertain except the follow-up Bde), the recipe lays the Main Body at 6.5 km and the flank guards at 17.5 km, the March times the Main Body from 6.5 km back. Report lines: within the spacing the bigger obstacle wins (a canal over a distributary). `advance.mjs` 42. Verified in the app east of Lahore: 7 water features on the routed axis (two distributaries with no bridge on it: Crossings fails), RL 1-3 and HA 1-3, the March row (the Adv Gd as a road column 10.0 km: warn), the flank guards 17.5 km out.

**Housekeeping (19 Nov 2026):** the unlocked copy of Sec 1 deleted; `master` fast-forwarded to the work; `tools/orbat-test/run.mjs` reads `MS/Data/Orbat/PK` (it read the parent folder and stopped before checking anything): 434 units, 200 weapons, 7648 checks, 0 failed, 8 warnings.

Verified in the app (dev server): 1, 2 Sqns on the Std Inf Bn's two up (33 and 34 symbols), the Lt Cdo Bn's three up with 2 Sqns (36), the force row naming the Sqns, Copy as Text and the Tank Sqns row; the Tanks row is absent on an attack (it has its own). **Not checked in the app:** placing the plan and the Tank harbour row on the real terrain (the map did not take clicks in that run); both are tested in Node with synthetic ground, and the placed plan's read-back in `check.mjs`.

Not done for armour: tanks to the secondary approaches' Sup posns (the main approach's C Pen posn only); tanks in a Coy defence or an attack's follow-up phase as a reserve; an Armr Regt or Tk Sqn as the unit of a plan (the layouts' frontages and depths are infantry rows); the Recce Regt / Sqn for screens; the Armd Div's Bdes (two Armd Bdes and a Lt Armd Bde have no contents in `armr.json`). Not done from step 2: AT grouping on a Bde plan (the only Bde plans are crossings, which take no unit); on an attack or a Coy plan; 3-Coy layouts for Bn Attk, Bn Crossing and Coy plans; LAT / HAT Coys by Pl (a Coy is 2 ATGM Pls of 6 launchers). Left for the next steps: armour, artillery, engineers, AD and aviation as their own units in a plan. Data gaps met: 224 of 308 child links in inf.json carry a role and no unit id; 1 of 13 tank guns in weapons.json has a range; 7 of 22 AD unit weapon lines are not linked to weapons.json; the Coy count is an infantry rule (it reads the arty Mtn Regt as 3 manoeuvre Coys and the Recce Regt as 0). `tools/orbat-test/run.mjs` still looks in `MS/Data/Orbat/` and not `MS/Data/Orbat/PK/`, so it stops before checking anything (not changed here).

**A built plan checked again reads the same (15 Nov 2026, the user: "why does the Auto plan fail when checked again?"):**

Check my plan used to read a placed built plan afresh. It ignored the roles on its graphics, so the reserve read as depth and "no reserve marked". It re-read the ground's kind, which fell the other side of a margin (an obstacle 5 of 9 points in front: Obstacle once, Plains the next time). It held the planned C Pen posn to a Pl's size, sought the approaches toward a different centre, used a different foot pace for the reserve, and had no AT cover, mines or what-if. Now:

| Piece | Where |
|---|---|
| A built plan carries `pbMeta` on its graphics (the ground kind it was fitted for and why, the enemy, the unit, the threat point) beside `pbRole` / `pbRecipe` | `PlanEntry.meta`, `PlanBuildTab._meta` |
| Check my plan reads a built plan by its roles (the recipe's slot kinds: fwd / depth / res / round; alt, sup, cpenPosn, Pls), its recipe's echelon, its ground, enemy, unit and threat; else its own front (forward posns ahead of the depth); the planned posns are not held to a size; all round is not judged on facing | `PlanCheck.mapPlan`, `checkDefence` |
| The approaches are sought toward the middle of the FDL (all round: the plan's middle) in both the build and the check, from the same assumed start; the C Pen posn on the main approach's line carried into the depth when it ends at the FDL | `PlanFit.fitPlan`, `PlanWhatIf.whatIf` |
| The reserve's pace is one rule in both: cpen.footKmPerH (E), the ground's in desert and mountains, mounted at the vehicle rate | `SolveOptions.reserveKmh`, `PlanCheck` |
| Check my plan runs the same AT cover (drawn BS), what-if and trigger table (alternates paired by letter: Alt A to A Coy) and minefield rows; the trigger table in its view and Copy as Text | `PlanCheck`, `movesRow` / `reserveMovesCheck` in `PlanWhatIf` |
| **J and a slow reserve**: the reserve carries its own moves' verdict, and J fits each try with the what-if, so it moves the reserve nearer when it can be made in time (and the plan ranks better); where no spot is, the check says: mount it, pre-position it or occupy the C Pen posn before he commits | `PlanWhatIf.reserveMovesCheck`, `nextBestSpot(…, refit)` |
| Checks: the same plan checked again gives the build's verdicts on 16 rows, each posn's verdict and the trigger table; J fixes a slow reserve (enemy tanks 12 km out: 2 fails to none) | `check.mjs` (97) |

Verified in the app at the BRB (Auto, threat east): all 18 shared rows, every posn and the trigger table the same both ways. The Auto plan's remaining fail is real and the same both ways: the reserve on foot reaches the C Pen posn in 45 min against the enemy's 33. Auto picks the best layout; it cannot make an unmounted reserve faster than tanks.

Roles and pbMeta go through Save Plan and Load Plan since 15 Nov 2026 (drawEss `PB`; see the two-phase section).

**Phase 6 built (15 Nov 2026), attack in depth:**

| Piece | Where |
|---|---|
| **Left / right flank recipes** beside frontal: the frontal assault group (FUP, SL, assault Coys, reserve, HQ, Assy Area) laid on a line 60° off (attack.flankDeg, E) onto the objective's flank, the FUP set back to 1000 m from its near edge, the LOE 600 m beyond its far edge along the assault, the BOF in front as the fixing force (OOW2 s6 para 12), the mortars central so the whole Obj and the LOE stay in reach | `Recipes/bn-attk-{right,left}-flank.json`, `index.json` (flanks first) |
| **Form of attack** row (user, 14 Nov 2026; MW p 79): frontal warns "dangerous, small chance of success: only if unavoidable"; Auto ranks a feasible flank (no fail) before frontal whatever its warnings, then the weighed score | `PlanSolve`, `PlanFit.rankFits` |
| **Finders** on the ground: FUP swung round the Obj (±20°, ±100 m) into ground hidden from it, kept 1000-1200 m off (IBB p173, p201); SL on a linear feature square to the axis with a clear run to the Obj (never behind an obstacle) and beyond the last fire lift (450 m + 150 m); BOF 600-1100 m from the Obj, 40-100° off the axis, where it sees most of the Obj and stands higher, laid facing it; Assy Area 1-5 miles back (IBB p173), hidden, a road within 300 m, outside his thermal sights (4 km) where hidden ground allows; the route on foot from it to the FUP round NO-GO, cut to legs within 75 m | `PlanAttack.findAttackSpots` |
| **H-hour sum**: the approach march (day / night rates, IBB p 18, + 15 %), forming up 30 min, FUP to the SL, the assault at 4 min a 100 m (E) slowed by the SLOW-GO share of the axis, the fire lifting at 450 / 360 / 275 / 180 m (IC s66 p305), the Obj, through it, the LOE; times back from H (H = crossing the SL); without the ground, straight lines | `PlanAttack.attackTimes`, `hSumRow` |
| **His MSR** behind the Obj (a bridge first, else a metalled road, 0.3-3 km beyond), and **left against right**: weighed factors with reasons (form, chokes his MSR, going, FUP hidden, approach hidden, BOF's view, SL, time; `attack.compareWeights`, E) as the attack's score; Compare shows them side by side | `findMsrChoke`, `attackFactors`, the tab's Compare |
| **Night**: Day / Night in the Task step; the Night March chart from the Assy Area to the FUP (legs, grid bearings, paces, leave-by, his night and thermal sights) | `nightBrief`, `nightRow` (NightMarchRead) |
| On the map while placing: the fire-lift rings with their minutes, the route with "leave Assy H-…", his MSR choke; the Check step's H-hour table, night legs and factors; Copy as Text | `PlanBuildTab._attackGraphics`, `_attackSection`, `_triggerText` |
| Checks | `node tools/planbuilder-test/attack.mjs` (34) |

Verified on the real bundle east of Lahore by night (objective near the border, own side west): Auto ranked left flank 90, right flank 78, frontal last; FUP in dead ground; no linear feature far enough out for the SL (taped); the BOF 600 m off at 40°, 4 of 9 Obj points in view (warn: recce a better one); the Assy Area 4.5 km back, hidden, by a road; leave it H-1 h 53, 3.4 km in 6 legs, inside his thermal sights from 990 m; the fire lifts H+22 to H+33, on the Obj H+41; the LOE ending by the bridge on his MSR.

Not yet: Bde / Div attacks. (The counter-attack approaches onto the Obj, two phases and tank FUPs were done the same day: below.)

**Two-phase attack built (15 Nov 2026):**

Any Bn Attk layout (frontal, right or left flank) can run in two phases: the Task step's **Phases 1 / 2** chip. Phase 1 is the layout as it stands, onto Obj 1. Phase 2 follows IBB S39-S42 (read 15 Nov, pp 174-211):

| Piece | Where |
|---|---|
| **The recipe**: Obj 2 behind Obj 1 (1.5 km centre to centre, his depth Coy, E); the follow-up C and D Coys in the reserve's place, 500-750 m behind the assault Coys (IBB p204 (7)); FUP 2, SL 2 and the phase 2 arrow round Obj 1's flank onto Obj 2 60° off his front (p186 h: a new direction, onto his flank, not through the Coys on Obj 1); the LOE 600 m beyond Obj 2; the mortars' step-up posn (planned, dashed) 300 m short of Obj 1 (p176 d); the BOF the Spt Coy's weapons; Obj 1 the firm base for phase 2 (p189 para 23) | `PlanPhase.twoPhaseRecipe`, `layPhase2` |
| **Geometry rows**: Phases; FUP 2 600-1200 m from Obj 2 (beyond the last fire lift) and 300 m clear of Obj 1; Ph 2 fire base (Obj 1 within the 106 mm RR's reach of Obj 2, firing 30° or more across the phase 2 axis); Reserve warns: no Bn reserve left, tell Bde (p186 i); the mortars reach the LOE from their step-up posn | `PlanSolve` |
| **On the ground**: Obj 2 on a hostile unit or posn drawn 0.9-2.5 km behind Obj 1 (within 45° of straight behind), else on his high ground there (8 m higher), else assumed (warn: draw his depth posn); the side round Obj 1 tried both ways and 15° either side: FUP 2 hidden from Obj 2 first, then the shorter way, no NO-GO on the arrow, the LOE nearer his MSR; the follow-up Coys' way laid round NO-GO and kept off Obj 1; the phase 2 arrow bent round NO-GO; Ph 2 going | `PlanPhase.findPhase2`, `goingRow`, `PlanFit.fitLayout` |
| **H-hour sum**: Obj 1 taken (through it), the follow-up Coys leave the FUP then (IBB p204 (7); `attack.phase2.waitAt` behind = close behind the assault from H, p186 h(2)), their way to FUP 2 at the day / night rate, 15 min forming up, H2 at SL 2, the fire lifting on Obj 2 from H2, Obj 2, the LOE; **Ph 2 timing** warns when H2 comes more than 60 min after Obj 1 falls (E; p176 c: he reorganises or counter-attacks) | `PlanAttack.attackTimes`, `phase2Row` |
| **Factors**: Phase 2 (FUP 2 hidden, the gap) weighed 0.1 (E); his MSR sought behind Obj 2 | `attackFactors`, `findMsrChoke` |
| **Map and Check step**: the lift rings on Obj 2 timed from H2, the follow-up Coys' way (dotted) with the time they leave, H2 at SL 2; the phase 2 lines in the H-hour table and Copy as Text | `PlanBuildTab._attackGraphics`, `_attackSection`, `_triggerText` |
| **Who follows up** (user, 15 Nov 2026: an option on a key while placing and a button beside the other options): **Ph 2 by** chips in the Task step under Phases, and **R** while placing flips them on the fly (the ghost is swapped and, at rest, fitted again on the spot; the card's foot names R). C, D Coys: both onto Obj 2, no Bn reserve (warn: tell Bde, IBB p186 i). C Coy, D res: C Coy onto Obj 2, D Coy kept as the Bn reserve (p186 h(3): commit only what the task needs; its reach timed). Either way the BOF is the Spt Coy's weapons. Default `attack.phase2.coys` (2) | `PlanPhase.twoPhaseRecipe(…, coys)` (ids `-2ph` / `-2ph1`), `PlanBuildTab._setCoys` |
| Checks | `node tools/planbuilder-test/phase2.mjs` (82) |

Fixed on the way (both from Phase 6, seen on the map): the BOF siter could put the BOF inside a wide objective (600 m from the centre of a 1500 m wide Coy locality); it now keeps 300 m outside its edge (`attack.bofOutsideObjM`, E; attack.mjs 34). His MSR bridge was searched every 100 m and a small turn of the plan could miss it; now every 30 m (`attack.msrChoke.stepM`).

Verified on the real bundle east of Lahore by night (own side west), Auto with two phases: right flank first; phase 2 round Obj 1's right (the left way 3.9 km against 1.9), FUP 2 hidden from Obj 2; Obj 1 taken H+89 min, H2 H+149 min (60 min after, at the limit), on Obj 2 H+180 min; the LOE 220 m from the bridge on his MSR; the BOF 300 m outside Obj 1; Obj 2 assumed (nothing drawn behind Obj 1); no Bn reserve (warn). All three layouts fit in 64-104 ms.

Figures to confirm (E): Obj 2 1.5 km behind Obj 1; phase 2 60° off his front; FUP 2 600-1200 m from Obj 2; 300 m clear of Obj 1; 15 min forming up at FUP 2; H2 within 60 min of Obj 1 falling; the default of both follow-up Coys onto Obj 2 (the user switches it per plan); the mortars 300 m short of Obj 1; the BOF 300 m outside the Obj.

**Finished 15 Nov 2026 (the user: "take sensible decisions and complete it, test it"):**

| Piece | Where |
|---|---|
| **P** while placing switches the attack between one phase and two on the fly (the ghost swapped, at rest fitted again on the spot); the card's foot names P (and R in two phases); the Phases chips do the same | `PlanBuildTab._setPhases`, `_swapPlan` |
| **Check my plan reads a two-phase plan**: an axis that starts within 1.5 km of another axis's Obj and goes on to a deeper Obj is a later phase from it (a built plan says so by its roles, `axis2` after `axis`); it is judged as phase 2: FUP 2 600-1200 m from Obj 2, the earlier Obj as its fire base (in reach, firing 30° or more across it), **Ph 2 direction** (300 m off the earlier Obj, and turned 30° or more or in a lane of its own 300 m or more aside: IBB p186 "a new direction", read as either, E); no BOF rows on it; a **Phases** row and, for a built plan, **Reserve** (warn when every rifle Coy is committed) | `PlanCheck.checkAttack` |
| **His counter-attack onto the last objective** (reorganisation, IBB p189 paras 22-23, p191): from his depth 4 km beyond it (straight behind and 45° either way, his front facing the own side), his least-cost ways in (tracked for armour or mech, on foot for infantry), joined ways counted once; each judged by what the objective sees of its last 400-1200 m (dead ground: an unseen run of 100 m or more, named with its distance: an LP and DF there); a DF target on each 600 m out. Replaces the solver's "not checked" **Approaches covered** row in the build and in Check my plan; drawn on the map (red dashes, "En CA from NE · dead Gr 410 m", DF crosses). Figures `attack.counter.*`, all E | `PlanAttack.counterAttack`, `PlanFit.fitLayout`, `PlanBuildTab._attackGraphics` |
| **Save Plan keeps a built plan's roles**: `pbRole` / `pbRecipe` / `pbPlanId` / `pbMeta` go into each symbol's drawEss as `PB` (as `PINNED` does); Load Plan puts them back on the graphic and keeps them out of the symbol's own drawEssentials; `SerializationEngine.planDocument()` builds the document Save Plan downloads | `SerializationEngine` |
| Fixed on the way: Check my plan read the frontal recipe's FUP, laid at exactly 1000 m, as 999.99 m ("inside his reach"): 1 m either way now (the build = the check) | `PlanCheck.checkAttack` |
| Checks | `attack.mjs` (42), `phase2.mjs` (96) |

Verified in the app east of Lahore by night: placed as one phase, P made it two on the spot (Rt flank 82); his counter-attack read from the NE, E and SE, each with dead ground 410-560 m out (warn, an LP and DF there); placed, Check my plan on the last placement gave the same Phases, phase 2 rows, Reserve and counter-attack verdicts; the plan document Save Plan writes carried all 20 roles, and loaded back they were the same, with Check my plan reading it as before. Fitting all three layouts with the counter-attack takes 62-77 ms.

Not yet: Bde / Div attacks; three phases; a phase 2 onto an Obj 2 the user drags; Load Plan does not restore a pinned symbol's pin (the Deployment Mgr's path does; older, not touched).

**Moves in time in the hills (15 Nov 2026, the user with a Bn Def two up in the hills: "why it says fail?"):**

Every move failed because the threat marker sat 0.5-1 km in front of the FDL and the enemy's times were counted from it (0-6 min to the FDL), and because in the mountains the own moves paid 30-60 min per 300 m of climb (MW p 81) while the enemy's approach did not. Now:

| Piece | Where |
|---|---|
| His times start **no nearer the FDL than his FUP** (IBB p201 infantry 1000 m, p214 tanks 2500 m, `enemy.types.*.fupFromFdlM`): a threat marker inside it gives the way he comes, his way is set back to his FUP along it; the Moves row and the trigger table say so ("his FUP 1.0 km out (the threat marker lies 450 m in front of the FDL ...)") | `PlanWhatIf.whatIf` (`enemyFromFup`), `enemyStartWords` |
| His **infantry pay the climb** in the mountains, the same figure as the own moves (`terrain.kinds.mountain.ascentMinPer300m`, every 50 m along his way); his vehicles keep their rates as the own mounted moves do | `PlanWhatIf.enemyMinutesTo` (`EnemyTimeOpts.g`) |
| A failed move now names its times in the Moves row ("Heavy shelling on A Coy (97 against 22 min)") | `movesRow` |
| Checks | `whatif.mjs` (28) |

Re-run on three hill sites (Kotli, Rawalakot, Murree, Bn Def two up): enemy to the FDL with the marker 1.3 km out 14-31 min (was 0-6), 5 km out 102-132 (was 56-70), no marker 183-294 (was 107-114); with the marker that near the shelled moves (28-97 min) still fail, honestly: they must start before he leaves his FUP.

Then (the user: "Yes, fix it"): the own routes on foot tried only the straight line and one detour point up to 1.5 km aside, while his approach is a least-cost way, so broken hills reported "no route" where a way round exists. Now, when no short detour gets round, `routeOnFoot` takes the least-cost way on the ground (findAvenue, `moves.routeWidthM` 100 m, E) when it starts and ends where the move does and is quicker; on such a way its own points decide NO-GO, and a stretch between two of them that clips NO-GO at a bend counts as SLOW-GO. Kotli: the reserve to the C Pen posn, "no route" before, now 5.4 km round the water in 204 min (fail against an enemy 5 km out at 104 min, warn with no marker at 213): the reserve stands too far back there. `whatif.mjs` (33).

**Moves in time laid out (15 Nov 2026, the user: "keep it honest but 1. format it well 2. also suggest why and how to fix"):** a check may carry `detail` (`PlanSolve.CheckDetail`: a headline, one line per item, why, fixes, and the card's short forms). "Moves in time" (the plan row and the reserve's own) fills it: each move with both times and its verdict (in time / little to spare / too late), the cause (his rate and start against the own move on foot, half as long again under shelling; no route), and fixes tied to the cause, most direct first: start the move on the first shelling (a trigger in the orders); commit or pre-position the reserve; mount the Bn (MIB / ABIB); J moves the reserve nearer; site the alternate nearer; set En type Inf if he is infantry (only while the type is the default); mark the threat where he starts; find a crossing. The cursor card shows the short form (3 moves, a one-line why, 2 fixes, "N more in the Check step") and stays on the map; the Check step and Check my plan show it in full; Copy as Text prints it under the row (`detailLines`). The verdicts are unchanged. `whatif.mjs` (41).

**Tanks with the attack built (15 Nov 2026), tank FUPs for armour-heavy attacks:**

IBB S44 para 16 a pp 213-216 (read 15 Nov): his ATGMs reach 1500-3500 m and stand 500-1000 m deep, so the tank FUP is 2500-3000 m out and a common FUP with the infantry is no longer feasible; S42 pp 181, 186-188; S35 para 7 b pp 144-146 (who leads).

| Piece | Where |
|---|---|
| **Tanks** chips in the Task step (None / Fire sp / Close sp) and **T** while placing (cycles them; the ghost swapped, at rest fitted again; the card names T). Works with one or two phases (the tanks go with phase 1) | `PlanBuildTab._setTanks`, `_rcp` |
| **The recipe**: FUP (Tks) 2750 m out on the infantry's axis line, 300 m aside away from the BOF (a place of its own, p181), A Sqn there. **Close sp** (armour heavy): the tanks' own axis converging on where the infantry enter the Obj (p186), the rear troop 1.5 km out on the BOF's flank (p188 c, p215 b). **Fire sp** (infantry heavy): the Sqn's fire posns beside the BOF, planned (p214 option a). Ids `-tkc` / `-tkf` | `PlanTanks.withTanks` |
| **On the ground**: FUP (Tks) 2.5-3 km out and 600 m either side where a hull 2.3 m up is hidden from the Obj and tracks go; the tanks' axis bent round NO-GO on tracks; the fire posns follow the BOF and the Sqn's way to them on tracks; **Who leads** from his fields of fire along the approach (the first unseen run of 100 m: beyond 500 m the tanks may lead, 500 m or less the infantry, 200 m or less a troop at most, Close sp warns there) | `PlanTanks.findTankSpots`, `PlanFit.fitLayout` |
| **Timing** in the H-hour sum: Close sp leaves FUP (Tks) to reach the infantry's assault line (250 m out) as they do, fires them on after the artillery lifts (p187 b(2)) and rushes to be on the Obj a minute before them; Fire sp reaches its fire posns as the infantry come as close to the Obj (H at the latest) and fires them on; night 8 km/h, day 16 (E); a note to cover their noise when they move before H (p215); **Tank fire range** at night 800 m with NVD, 1600 m registered (p214); **Tank going** on tracks | `PlanTanks.addTankTimes` |
| Geometry rows (no ground): Tank FUP (2500-3000 m), Tanks (the role), Who leads not checked | `PlanSolve` |
| **Check my plan**: an arrow labelled Tks, with role `tkAxis`, or from an FUP 2 km or more out with armour beside it is the tanks' axis: its FUP judged in the tank band, no SL or BOF asked of it, its going read on tracks, not taken for a phase | `PlanCheck.checkAttack`, `PlanTanks.tankGoingRow` |
| Map: when the tanks leave FUP (Tks), their way to the fire posns, when they reach the assault line and are on the Obj | `PlanBuildTab._attackGraphics` |
| Checks | `node tools/planbuilder-test/tanks.mjs` (58) |

Verified in the app east of Lahore by night: Close sp (Auto left flank): FUP (Tks) 2.7 km out, hidden; his fields of fire end 280 m out on that axis (the infantry leads); the Sqn (-) leaves H+6, 3.2 km in 28 min, at the assault line H+34 as the infantry reach it, on the Obj H+43, the infantry H+44; Tank going 29 % SLOW-GO. T on the fly to Fire sp (Auto right flank): fields of fire 600 m (the tanks could lead); the Sqn leaves H-13, 4.3 km in 36 min, at its fire posns H+23 as the infantry come 460 m from the Obj, inside the 800 m night range. Placed, Check my plan read the tank axis as the tanks' (FUP 2.6 km in the tank band, Tank going pass).

Figures to confirm (E): FUP (Tks) 300 m aside of the axis; the search 600 m either side; tanks 8 km/h by night, 16 by day; the rush 15 km/h; on the Obj 1 min before the infantry; the rush from 250 m (the farther assault line figure); the rear troop's place on the BOF's flank.

Not yet: the Sqn's own harbour and its move to FUP (Tks); tanks with phase 2; ATGMs and the en AT ranges from the ORBAT for the tank FUP (the doctrine band is used); Bde / Div attacks.

**Phase 8 built (15 Nov 2026), ambush, patrol and recce** (the user: "Ambush, Patrol, Recce"). Wrapped over the Movement Guide
and Platoon Guide engines; their card APIs and outputs are unchanged (`movement-test` 31 + 38, `platoon-test` 57 still pass).

| Piece | Where |
|---|---|
| **Recipes**: Pl Ambush line / L / V (pivot: the KZ centre, aimed up the road toward where he comes from; KZ, Ambush arc with its arrow into the KZ, Fire Gp, Stop 1 on his side, Stop 2 beyond, RV 800 m back, withdrawal); Pl Patrol (pivot: the SP, the second click is the Obj; FRV, routes out and in, check points at the bounds); Pl Recce two / three OPs (pivot: the SP, the second click is the NAI; Recce Outposts, routes). Basis E: the rules are R (OCOKA_Roadmap ch 6, IC / IBB pages to cite), the layout figures mine. New: recipe `pivot`, layouts `patrol` / `two-ops` / `three-ops`, `SMALL_TASKS` | `MS/Data/Deployments/Recipes/pl-*.json`, `PlanRecipes.ts` |
| **Figures** (all E but the R bands): KZ on the road within 50 m of the click, none within 300 m fails; the road read 1.5 km toward him and 800 m beyond; KZ seen 80 % (50 % fails); a better site 10 points up; RV 750-900 m (R); FRV 400-500 m and bounds 550-750 m (R); seen 20 / 50 %; 60 min at the Obj; a 10 h night; OPs 600-2500 m out (best 1-2 km), within 60° of the line back, 300 m apart; NAI seen 70 % (40 % fails) | `PlanDoctrine.json` `smallOps.*` |
| **Geometry only**: the shapes laid by the solver; the patrol's Obj and the recce's NAI follow the cursor while aiming (the Mgr now hands the aim point to the hooks); RV, FRV, OP range and OPs apart checked; every ground row grey | `PlanSmallOps.solveSmall`, `PlanSolve` (small-task branch), `DeploymentBuilderEngine` (`onGhost` / `prepareCommit` cursor) |
| **Ambush on the ground**: the road under the click (tile pieces joined end to end, the straightest on), read toward him with the Movement Guide's scanner for the target (Target chips Wheeled / Tanks / On foot, **M** while placing); the spot scored and laid as the layout chosen (`ambushSiteAt`: the body of `ambushSites` for any station, its shape forced, the ground's shape reported); rows Road, Target held, Hidden from behind, Fire posn, KZ in view, Stops, Withdrawal, RV, Reinforcements (his QRF time), Village, Layout (the ground suits an L / V), Site (the + / - lines), Better site (up to two along the road, blue rings, 10+ points better). The KZ stays inside the fire line (60 % of its offset, 12-40 m) | `PlanSmallOps.readAmbush`, `roadAround`; `MovementGuidePlans.ambushSiteAt`, `stationAtChain` |
| **Patrol on the ground**: `planPatrol` (round NO-GO, away from roads, villages, skylines and the view from the threat marker or else the Obj; wood edges by night: Time chips), routes straightened to legs a patrol can walk by night (60 m, at most 11), `patrolCard` on each; rows Route out (its length against the straight line, warn past 2x), Bounds (legs ending on a feature), Route in (share along the way out), FRV (hidden from the Obj), Seen, Villages, Skylines, Dangers, Obstacles, Time (out + at the Obj + back against the night); the route card in the Check step and Copy as Text | `PlanSmallOps.readPatrol` |
| **Recce on the ground**: OP candidates every 150 m and 10° on the own side and on hills, peaks, knolls, trig points, towers; each scored on the NAI points it sees (5 x 4), height above the NAI, cover, distance; picked for what each adds to the others; routes in dead ground (`planPatrol`, the NAI as the threat); rows OPs sited, NAI seen (each OP in the detail), OP view (an OP that sees almost nothing), OP ground, OPs apart, Routes hidden, Time (each route against the straight line) | `PlanSmallOps.readRecce` |
| **The tab**: Ambush / Patrol / Recce chips live (Crossing still later); no enemy force, ground kind or ORBAT rows for them; Enemy step says how to place each; the card's last line (target, site, better site; legs and night minutes; % of the NAI seen); map products (the road and the KZ points seen green / red, better-site rings; the patrol's stretches seen red / hidden green and dangers; the NAI points seen and each OP's share); Compare shows each layout's own rows; Check my plan says it reads defences and attacks only | `PlanBuildTab` |
| Fixed on the way: the Freehand Dotted Arrow (`00000007`) drew as a bare point when a plan document gave it `GEOM: null` (the patrol's route in, the ambush's withdrawal; the Movement Guide's Create on Map uses it too); it now draws from the control points as the solid arrow does | `MS/Symbols/FreehandDottedArrow.ts` |
| Checks | `node tools/planbuilder-test/smallops.mjs` (77, on the Movement Guide's synthetic world) |

Verified in the app east of Lahore: **ambush** on the canal bank road by the BRB, aimed NNW: KZ on the road, the canal holding his vehicles on one side, a bend hiding it, Fire Gp in cover on the built-up side, KZ 100 % in view, RV 800 m NE, a post 0.7 km away (QRF about 6 min) and Jallo Mor within 1 km (warn), Stop 2 not seeing the road beyond its end (warn), the ground suiting an L (Compare: L 61, line and V 51), a better site 660 m toward him scoring 74. **Patrol** by night 5.4 km east: out 7.6 km in 11 legs (1.4 times straight), back 7.0 km by another way, FRV hidden 450 m short, 3 % seen, 3 canals to cross, 9 h 13 of a 10 h night. **Recce**: an NAI in the Wara villages gave 30 % seen (fail, honest: buildings), one in open crops 70 % with two OPs (OP 2 in the open: warn). Placed plans drew all their symbols, the dotted routes included.

Figures to confirm (E): every `smallOps` figure but the R bands; the target's height 2.4 m and the eye 1 m; QRF 30 km/h + 5 min.

Not yet: the Night March chart for the patrol (the route card is there, with mils and magnetic). Done since (see "What was left" below): Check my plan for them, the Coy screen and the area ambush, J for a better ambush site, leg ends on features.

**Phase 7 built (15 Nov 2026), crossing and bridgehead** (the user: "Build Crossing"). Read for it: IBB S46 pp 231-241
(bridgehead battle, space, break-in phases, Figs 20-22), S47 pp 242-246 (enemy defence on a major water obstacle, Fig 23),
Annex Q pp 467-468 (engineer technical data); IC s70-71 pp 355-366. Over the Movement Guide's Water engine (readWater,
readReach), unchanged (`water.mjs` 56 still passes).

| Piece | Where |
|---|---|
| **Recipes** (pivot H: the click on the water where the first wave enters, IBB S46 para 25 p240; aimed across): **Bn Crossing** two up (A, B Coys on about 300 m of the bund each, IC s70 para 4c p358; Bn front 500-800 m; C Coy H+20 through to OBJ 2 600 m deep; D Coy reserve; bridge between the assault Coys; Veh Wait, RP on the far bank, checkpoint, Bn Assy: IC s71 paras 7-8 pp 362-364); **Bde Crossing** two up (two Bns on 650 m, 550 m apart, two crossing places each; PL 1 450 m beyond the bund on 1.9 km; the third Bn through to 1500 m; BH 3750 x 1650 m: IBB S46 paras 20-22 pp 238-239) and four Bns (BH 2.5 km deep, para 23 Fig 22); **Div Bridgehead** two Bdes (four FUPs, PL 1 per Bde, PL 2 7.5 x 1.65 km, BH 8 x 6 km = 48 km2, two bridges, bases of fire between and on the flanks, follow-in Bdes: paras 17-21, Fig 20) | `MS/Data/Deployments/Recipes/{bn-cross,bde-cross,div-bridgehead}-*.json`; layouts `four-bn`, `two-bde` |
| **Symbols as in 2525D**: Assault Crossing `25271300` and Bridge `25271400` (the bracket shape of DISA's templates, Esri JMSML `svg/Appendices/ControlMeasures`, drawn by the existing Bridge class: base line along the home bank, far end on the far bank) | `Symbols.json` |
| **Figures** (D, page cited, unless E): bridgehead bands, coy bund, the drift 2 x the width, M2 boat 12 men 10 min a round trip per 30 m and 48 a division, rafts and bridges with their build times by day / moonlight / dark night and the spans each formation holds, lanes needed after 3-3.5 h, breaching per 108 m, bridge-layer limit 24 m (80 ft), his minefield 900-1000 m; E: 16 boats a leading Bn, 96 men a Coy, the observer 2 m / target 1 m / 3 km, bank seats 10 m, a Sqn of 14 tanks, a 10 h night, the bridge search 400 m, high far bank 1.5 m | `PlanDoctrine.json` `crossing.*` |
| **Geometry only**: Fronts, Phase 1 and Bridgehead against IBB S46 (all pass as laid); Obstacle, Crossing means, Observed fire, Bridge site, Approaches and exits grey; the recce list of IC s71 para 5 | `PlanSolve.crossingGeometryRows` |
| **On the ground**: the obstacle at the click (type, Annex P, width, depth, current, banks with their sources); the whole plan re-laid along it (`ObstacleFrame`: x along the water, y across from the bund, lines and areas bending with it; an item wholly on one bank measured from that bank's crest); the bridge site moved to the narrowest, lowest-banked place with firm tracks within 400 m (an existing bridge there said); his observers: far-side ground within 3 km that sees the crossing places or the bridge, the BH line reaching out to take them up to its doctrinal depth (1.8 km two up, 2.5 km four Bns, 6 km Div), those left in front or on the flanks said with fixes; rows Obstacle, Far bank (high: ladders, grapnels), Season, Boats, Rafts, Bridge, Tanks across, Night, Drift, Fronts / Phase 1 / Bridgehead, Bridge site, Approaches and exits (a NO-GO strip by the bank), Crossings near, Assy areas (seen from the far bank), Observed fire. Ground still loading at the click is grey, never "no canal" | `PlanCrossing.ts` (`fitCrossing`, `ObstacleFrame`) via `PlanFit.fitLayout` |
| **The tab**: Crossing chip live; Light chips Day / Moonlight / Dark night (the Annex Q column); the Enemy step says how to place it; card line (obstacle, bridge and tanks times, observers outside); map products (the obstacle, observers red outside / amber inside, drift entries, crossings near); Check step timeline from H and the bridge sites; Copy as Text "TIMELINE FROM H"; Compare shows the layouts' own rows; Check my plan says it does not read crossings | `PlanBuildTab.ts` |
| Checks | `node tools/planbuilder-test/crossing.mjs` (37, on the Water engine's test canal with a far-side ridge and knoll) |

Verified in the app on the BRB Link east of Lahore (H on the water, aimed east), Bde two up: the canal read (Link canal, Annex P 4, 76.2 m and 6 m deep from the sheet, banks 3-12 m); the plan laid along it, Bde and Bn Assy Areas, Veh Wait and FUPs on the west bank, OBJ 1-3, PL 1 and the BH line square to the water on the east; boats 25 min a round trip, C Coy H+0:25, the Bn across H+1:04; 86 m to bridge needs the 195 m M2 set, more than the division's 84 m (warn), open about H+6:30 on a dark night; a tank Sqn by Class 50 raft only by H+10:53, so the Night row warns; drift entries 152 m upstream; three bridges and a ford nearby listed; no far-side ground within 3 km sees over the banks. A click 600 m off the water gave the honest "no water within 400 m" Fail with its fix.

Figures to confirm (E): see the table; the bridge timed from H (engineers start at once); the third Bn's crossing; the 10 h night.

Not yet: Corps bridging chosen for a Div with a wider gap. Done since (below): Check my plan for a drawn crossing, the canal defence, crossing places moved, his minefield and lanes.

**What was left, done 15 Nov 2026** (the user: "do what is left", after Phases 7 and 8). Read for it: IC s85 pp 449-458
(defence along a water obstacle / canal), IBB S57 paras 25-26 pp 316-318, Fig 34; IC s73 pp 378-381 (screens); IC s44
pp 146-158 (ambush: point and area ambush, Fig 16).

| Piece | Where |
|---|---|
| **Crossing places moved**: each assault Coy's crossing place slides up to 150 m along the bank (E) to a narrower, firmer place with a better approach; its lanes follow | `PlanCrossing.ts` (`placeSearchM`) |
| **His minefield, lanes, breach times**: the Mf chip lays a `-mf` variant of any crossing recipe (`withMinefield`): his minefield (Minefield `25270706`, hostile) 900-1000 m beyond the bund (IBB S47, D), lanes as Breach `25340200`; the Breach row: 108 m of lane per engineer Pl, 4 / 5 / 6 h by light, the next Pl every 100 min (IBB Annex Q, D), lanes wanted by H+3-3.5 h (D) | `PlanSolve.breachRow`, `PlanCrossing.withMinefield` |
| **Canal defence** (`bn-def-canal`, in the Bn Def family): the mirror of the crossing. The canal read at the click (`canalPrep`, the Water engine's purpose "hold"), the Bn laid along it: two up on up to 4500 m, three up to 5000 m, Coys 1500-2000 m, 3000 m deep (D); FDLs 70 m from the centre line, mask posns 400 m ahead on his side, his-side minefield 200 m (E). Rows Canal, Higher bank (an estimate range that overlaps reads as equal, never "his higher" by a guess), Bridges in sector (strong points, ready for demolition), Marsh, Obstacle value; confirm list includes demolition and the Irrigation Dept | `PlanCrossing.canalPrep`, `PlanFit` canal path, `PlanDoctrine.canal` |
| **Check my plan reads them**: a built ambush, patrol, recce, screen or crossing is read as drawn (nothing moved, no site searched) with the build's own rows; the same verdicts as built (proved in the Node checks); unlabelled slots named by their group (Outlying 2 fire line, Route to 1 Pl) | `PlanSmallOps.checkSmallOp`, `PlanCrossing.checkCrossing`, `PlanBuildTab._checkBuiltSmall` |
| **J on an ambush**: J while placing takes the KZ to the best better site along the road (the blue ring), the aim kept; Shift+J takes it back. The Mgr's new `moveAnchor` (host method) moves the pivot during the aim | `DeploymentBuilderEngine.moveAnchor`, `PlanBuildTab._jumpAmbush` |
| **Patrol legs on features**: the route's turns pulled onto a feature recognisable at night (PlatoonDoctrine `legFeatureKinds` within 150 m: bridge, tomb, mosque, junction, hill ...) when both legs to it stay off NO-GO on foot | `PlanSmallOps.snapLegEnds` |
| **Bearings**: route cards and the attack's night legs in grid degrees and mils (6400), magnetic too when `planBuilder.gmaDeg` is set (Settings, Display; magnetic = grid - GMA) | `PlanBuildTab` `brgText` / `_brgCell`, `PlanBuilderSettingsManifest` |
| **Coy Screen** (`coy-screen`, task recce, layout `screen`, basis D): IC s73 pp 378-381. Click the Wdr RV in the main posn, aim at the ground in front; that ground kept to the points that see the main posn (where he would watch it from); three Pl posts 300-1500 m forward across a 3 km front, picked for the view each adds, then the nearer (no further forward than necessary, p 378), then spread across the front (laterally with intervals); withdrawal routes in dead ground to the RV; the 2525D Screen `25342203` from the outer posts. Rows His viewpoints, Ground in front seen, Posts forward, Laterally, Post ground, Withdrawal, Time back; confirm: withdrawal on the order of the commander who ordered it, or on 50 % casualties / the time up if comms break (p 381), mines in front and on the flanks (p 380) | `PlanSmallOps.readScreen`, `PlanDoctrine.smallOps.screen` |
| **Pl Area Ambush** (`pl-ambush-area`, layout `area`, basis D): IC s44 p 152, Fig 16, not laid by less than a Pl: the central site laid as the line ambush, an outlying ambush (a Sec point ambush) on his way in up the road and his way out down it, each at the best stretch 400-1200 m from the central KZ (E), read for its site score and its stretch in view; row Outlying. The IC has no Sec ambush of its own: the outlying ambushes are the Sec ambushes | `PlanSmallOps.readAmbush` (`area`), `PlanDoctrine.smallOps.ambush.outlying*` |
| **Honest while loading**: a screen or recce with the ground still loading says "sited so far", grey, never "NO-GO fills the ground"; no post row passes with no posts to judge | `PlanSmallOps` |
| Checks | `smallops.mjs` 107, `crossing.mjs` 58, `recipes.mjs` 24 recipes / 98, `solve.mjs` 427 |

Verified in the app east of Lahore: **Coy Screen** aimed east over built-up ground: His viewpoints warns (no ground 2.3-3.3 km out sees the main posn: early warning only), the posts see 25 % of the ground in front (Fail, with its Why and Fix), the Screen symbol from 1 Pl to 3 Pl, the ways back drawn. **Pl Area Ambush** on the Khera - Barki road by the BRB: the site 30 / 100 (Fail) with a better site 850 m down the road (70); J took the KZ there (851 m), the site then 70 with one warn, the outlying ambushes 650 m up and down (51 each); Shift+J took it back; placed, Check my plan on the last placement gave the same verdicts (0 fail, 1 warn). Not checked in the app this round (Node only): the canal defence, the Mf chip, crossing places moving, Check my plan on a built crossing.

Figures to confirm (E): screen front 3 km, posts 300-1500 m and 400 m apart, the near pull 25 points; outlying 400-1200 m, its KZ 80 m, site 40, seen 60 %; canal FDLs 70 m from the centre, mask posns 400 m, his-side minefield 200 m; crossing places 150 m.

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

**Decided 15 Nov 2026** (after the mockup `plan-builder-options.html`):

- **Where it lives:** a **Build** tab of the Deployment Mgr, beside **Samples** (today's list). Code goes in
  `MS/Engines/DeploymentBuilder/` (new files beside the engine, not a separate `PlanBuilder/` folder). It keeps the
  Deployment Mgr's ghost, pivot, Place, Last placement and undo; no key of its own.
- **Fit at rest:** while the mouse moves the plan is a quick ghost at doctrinal spacing; 0.35 s after it stops the full
  fit runs (slide out of NO-GO, checks, Auto ranking); click places. (`planBuilder.fit.restMs`.)
- **Coy size:** the doctrine figure, **1500 × 600–800 m** (IBB Annex U App 6 p481 frontage, App 5 p480 depth), not the
  1 PR sample's 2.3 × 3.2 km.
- **Steps:** Task → Enemy → Place → Check → Create (Fit and Adjust merged into Check).
- **Start:** Phase 0 now.
- **Tab names (user, 15 Nov 2026):** the Deployment Mgr's tabs are **Templates** (was Samples: the ready plans) and **Intelligent Deployment** (was Build). Code ids stay `samples` / `build`, settings stay `planBuilder.*`.

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
| Bde Def (12 Bde) | `tools/planbuilder-test/fixtures/Bde Def 12 Bde.json` | The centre sector between Bdy 10 and Bdy 11 (34 symbols). The 80 km minefield belt and the Div VG are left out, and the IB is cut to the sector. **Taken off the Templates list (user, 15 Nov 2026)**; kept only as the Check my plan test fixture (`check.mjs`, `orbat.mjs`) |

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

### 17.3 Built (14 Nov 2026): `MS/Data/Orbat/`

Extracted from **SO's Handbook (2019)** (RESTD), Secs 1–7, 10 and 13. Figures are as printed, with page numbers.

**Files:**
- **Per arm:** `inf.json`, `armr.json`, `arty.json`, `ad.json`, `engr.json`, `sig.json`, `avn.json`, `log.json`
  (own side), and `en.json` (Sec 13 Threat, enemy side).
- **`weapons.json`:** 198 weapons and platforms. Each keeps its printed ranges and adds `planRangeM` (min / eff / max /
  ceiling, the lowest printed figure where the book gives several) and `symbolKeys` (the Symbols.json equipment entry
  judged by type and calibre).
- **`index.json`:** the file list, echelon codes and counts.

**Units:** 429 in all (353 own, 76 enemy). Each unit has:
- id, name, arm, type, subtype, `echelon` (2525D code), `symbolKey` (Symbols.json land-unit entry);
- `strength` (offr / jco / sldr / sw / att … / total);
- `children` (count × role → unit id), which records who is under whom;
- `weapons` (count, name, `weapon` link with `weaponMatch` exact / alias / contains);
- `equipment`, `vehicles`, and notes.

**Planning tables:** `engrData` (bridges, rafts, minelaying rates, breaching, inundation), `logData` (lift, ammo / POL /
rations / water loads, casualty rates, DAA), `sigData`, `threatData`.

**Kept as printed:** where the book's totals and parts disagree, the printed figure stays and a note or `uncertain`
says so.

**Checker:** `node tools/orbat-test/run.mjs` checks ids, child links, echelon order, weapon and symbol links, and that
any strength that doesn't add up carries a note. Result: 2310 checks, 0 failed.

**Handling:** `MS/Data/` is tracked by git, so these RESTD files go into the repo with the code unless they are
git-ignored. **Your decision is pending.**

When the files are absent or `planBuilder.orbat` is off, the recipes fall back to the doctrinal defaults with
"ORBAT not loaded".


**Estimates against the books (19 Nov 2026, the user: "replace with authentic sources from books"):** the 142 E figures in PlanDoctrine.json were searched in the books with a text layer (IC, GSP 1947 Inf Div in Battle, The Mechanised Infantry Battalion in Battle, Staff Duties in the Field Vol I-II, OoW Vol III, Amplification of Military Terms, Logistics Support in the Field, SO's Hbk 2019 Secs 1, 2, 4, 6, 9, 11, 13), every quote checked against the page it is cited to. A figure replaced an estimate only when it is own-forces doctrine in an official book and the same quantity; the notional enemy's figures (IC s113-114, Foxland) were not used for own quantities, nor an unofficial appreciation guide, nor NBC-only tables.

Applied (basis D, the quote in `src`): `crossing.coyMen` 130 (SO's Hbk Sec 6 p 606), `crossing.boatsPerBn` 22 (MechInfBn p 270: enough boats for the leading waves; 2 x 130 at 12, IC p 615), `crossing.sqnTanks` 14, `crossing.light` dark (IC p 355), `canal.maskAheadM` 300-500 m (IC p 462), `smallOps.ambush.movers` (IC p 146), `smallOps.patrol.taskMin` 60 (IC p 132), `smallOps.screen.fwdM` 1-1.5 km (Amplification p 1.2; IC's 600 m knoll the exception), `enemy.defaultType` mech (IC p 663), `alt.spacingM.secPl` 200-300 m (IC p 367), `attack.fupMin` and `attack.phase2.fupMin` 5 min (IC p 312), `attack.counter.dfOutM` 550 m (IC p 651), `attack.counter.lastStretchM` 400-1189 m (IC p 651, SO's Hbk Sec 6 p 648), `attack.phase2.fup2FromObj2M` 1000-1200 m (IC p 333). The nearest printed figure, and why it was not used, added to the notes of 14 others.

`terrain.kinds.obstacle.bdeFrontageM`: the user chose the book, 8-10 km (GSP 1947 s26 p 119, an own Bde on a ditch cum bund) over the 20-27 km estimate; the Demo 2 Bde Def sample (26.2 km) now fails Frontage on an obstacle, as the check expects.

The locked books (IBB, IPB, Mountain Warfare, Desert Warfare, Security Zone Battle, OoW Vol I and II), unlocked locally by the user and searched the same way (19 Nov 2026):
- Applied (basis D): `smallOps.screen.frontM` 3000-5000 (IBB p 277, a Bn in defence; the build lays 3000 as before), `attack.tanks.rushFromM` 250 (IBB p 187, '150/250 metres from the objective'), `size.plPostFrontageM` 300-400 (IBB p 277), `cpen.footKmPerH` 4 (IBB p 18, plains by day; was 5).
- At 4 km/h the Bn two up samples' reserve, 3.3 km deep (inside IBB's 3-4 km), takes 36 min to the C Pen posns against IBB p 279's 30 min: Reserve reach now warns, and solve.mjs / orbat.mjs expect the warning. On a Bn two up layout the two IBB figures pass together only under about 2.9 km of depth.
- Pages confirmed, `pageToConfirm` gone: `standoff.lpM` (IBB p 296 'about 300', IC p 145 '350 to 400'), `standoff.standingPatrolM` (IC p 144), `standoff.wireFromPostsMinM` (IC p 583), `df.perBn` (IBB p 107), `cpen.coyMin` / `bnMin` (IBB p 279), `cpen.decisionH` (IBB p 310), `cpen.perBn` (IBB p 309), `alt.spacingM.atgm` and `atFramework.atgmDetSpacingM` (IBB p 72), `atFramework.shortRangeAtFwdM` (IBB p 293), `readyBy.coyPosnH` (IC p 399). Four of these are in IC, not IBB as first noted.
- Noted only (a different quantity): `attack.assyPreferM` (IBB p 180, the Assy Area 1-5 miles from the enemy, a band), `crossing.highFarBankM` (IBB p 243, banks 4-6 ft, a bank height; the old IC s70 para 4f citation was wrong), `securityZone.bdeM` (no Bde figure; SZ Battle p 3, Amplification p 3.7).
- Not printed in any book: Pl corridor, height above approaches, Pl depth (IBB Annex U's arrows are unlabelled), C Pen settle time, Coy / mortar / battery alternate spacing, moves under fire, RL spacing, the bridgehead per Bn, observation ranges, Bn HQ boat load, bridge seats, night hours, canal FDL and far minefield depth.

Left: 122 E figures, 50 of them tool settings no book prints (search steps, eye heights, shares in view, score weights); the doctrinal rest were searched in every book above and are not printed for the same quantity.
**Checked in the app (20-23 Nov 2026):** a Bde crossing on the Lahore Minor and an Armd Bde advance west of Lahore, built and then read back by Check my plan.
- Crossing Arty reach: measured behind the FUPs in the obstacle's frame (Fd Regt 2.3 km, inside 1.0-3.5 km). Works.
- Check my plan, crossing: it read the canal as far as the farthest symbol's straight distance from H (the gun area 3-4 km back), so on a bending canal the plan was read against the wrong stretch (fronts 650 / 900 m, BH 2.7 km, against 650 / 650 m and 3.8 km built). It now reads as far along the obstacle as the symbols lie, as the build does (`250cda7`). Test: `crossing.mjs`, a canal doubling back 300 m behind the home bank (the old code reads FUP 2 5.0 km wide).
- Check my plan with the tiles not yet in (the probe opened fresh): the first read shows Obstacle not checked (still loading); when the tiles arrive it reads again by itself (all 17 rows by 1.5 s).
- Advance report lines: within the spacing, the bigger obstacle wins; water of the same rank (permanent water, a canal) is now decided by its width on the axis (`250cda7`; `advance.mjs`).
- Check my plan, advance: an axis read as drawn says so (it was called the least-cost way; `250cda7`); report lines read as drawn are checked against the spacing set in the Build tab (it quoted the default 1 km, E), and warn when two lie closer than that (`advance.mjs`).
- Axis route 'no way for tracks found': the router on the real tiles (156 legs, 74.20-74.38 E, 31.49-31.54 N) found every way a flood fill over the whole 25 km grid finds; the 48 it did not route have no tracked way at all (the Ravi bed, 1.1-1.3 km of permanent water). The row now names the leg with no way (the other is laid along its way) and points to unbridged water on the axis.
