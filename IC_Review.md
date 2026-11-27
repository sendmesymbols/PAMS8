# IC review: "The Rifle Company, Platoon and Section in Battle" against the Intelligent Deployment tab and the Ground Guide

This review was built on 27 Nov 2026 from a full read of `Material/IC.pdf`: 691 pp, with a text layer. The printed page is the PDF page.

The audit was read-only and nothing has been changed yet. Each item was checked by reading the code. The top items were checked again against the book page.

Statuses:
- **WRONG** — the engine does something the book contradicts.
- **MISSING** — a book rule that the engine lacks.
- **E→D** — the engine marks a figure E or R although IC prints it.
- **CITE** — the page, section or words are wrong.
- **DIFFER** — IC and another book disagree. You choose, and the two stay side by side.

Two findings were confirmed by re-reading the page in the book:
- s113 para 20 b (1) p 663 prints "400 metres wide" (Foxland).
- s68 para 12 e (1) p 333 prints "1000 to 1200".

**Existing refs:** 57 `"book": "IC"` refs in PlanDoctrine / OcokaDoctrine all pass `verify.py`. It checks only the quoted words. Pages written in `src` strings, notes and code are never checked, and that is where about 60 page and section errors sit, mostly one page late.

## Status (27 Nov 2026, the same day)

**Fixed:** IC1-IC11 and IC13-IC22, every §3 cite, and most of §2 and §4. In §4 the IC figure now stands beside the other
book's, and IBB's layouts are kept. Not committed.

**IC12 was an audit error.** Recipes are written [across, back], and the solver turns `back` into y = -back
(PlanSolve.ts:5), so the ambush seeds were never mirrored. A geometry test now proves it.

**Decisions taken:**
- **En assault pace:** 2 min / 100 m drives, named as IC's fastest (hasty defence), with 4 min shown beside.
- **En quick attack:** own drills drive, with IC's Foxland 2-3 h beside.
- **En infantry by day:** 4.5 km/h (IC s113 para 20 c), with IPB beside. This applies in the what-if and in the Ground
  Guide's Decision tab.
- **Own attack figures:** assault pace 3 min / 100 m; on the Obj, fighting 90 / 60 min and reorganisation 40 min (all
  Understanding Aprc pp 20-24).
- **Unknown light** = night.
- **Advance:** water lines are bounds, and report lines go on lateral roads and railways (IC s58). The old OoW
  definition was a reader's typed page-head overlay.
- **Built-up area defence:** localities are 400 x 300 m (E).
- **Ambush:**
  - fire line 30-120 m by night and 30-250 m by day (E);
  - tank kill zone 400 m (E);
  - a reserve and a covering group are added.
- **DF count:** 6-12 (MIB, IBB, IC).
- **En frontage rows:** IC s114 para 7 is used off the bund for the Sec, Pl, Coy and Bde; the Bn and Div keep s113.
- **Air defence:** the AD code gives an ambush, patrol or recce no vulnerable points, because the ambush's `res` slot is
  not a Bn reserve.

**Open:**
- `divFrontageM` 60-80 km (IC s113, the Indian Div) is still used for an own Div on an obstacle, marked as such. This is
  your decision.
- `rankFits({ holdM })` is ready, but the tab has no "frontage to hold" to pass it.
- IC Annex R is not in the PDF.
- ocoka-test "crop mix" was failing before this work (data).
- Wire timings and tank light are notes only.

**Checks:**
- `verify.py --write` finds every ref in PlanDoctrine, OcokaDoctrine, IpbDoctrine, MovementDoctrine and PlatoonDoctrine.
- All planbuilder (23 suites), ipb, movement, platoon, aprc, sitefinder, nightmarch and orbat suites pass.
- tsc shows no errors in the touched files.
- A browser smoke test opened the Intelligent Deployment tab and the Ambush Day / Night row.

## 1. Wrong behaviour (fix first)

| # | Where | Now | IC | Fix |
| --- | --- | --- | --- | --- |
| IC1 | `bn-attk-frontal/left/right/bua/mtn`, `bn3-attk-*` (line 12 `frontageRow`, axis `widthM: 400`, note "IC s113 set-piece row") | Own Bn assault 400 m wide, taken from the **Foxland** row | s113 para 20 b (1) p 663 is the En Bn. Own row: IBB S47 para 17 a p 248, 450-650 m (`attack.assaultRow`) | Use the own row. Make the `recipes.mjs` guard catch "IC s114" too (it only catches s113) |
| IC2 | `PlanAttack.ts:151-168`, `attack.slBeyondLiftM` | The SL is walked forward to the first linear feature, with the last lift + 150 m (~600 m) as its only floor. Night is not known | Night: FUP / SL 1000-1200 m in plains, out of En direct fire (s68 para 12 e (1) p 333). The SL is the FUP's forward edge (s68 para 13 a p 334). En observed fire ~1000 m (s68 para 2 c p 326) | Pass `night`. By night, the SL goes at the FUP edge or ≥ 1000 m |
| IC3 | `PlanSolve.ts:663-664`, `PlanCheck.ts:904, 968-972`, FUP finder `PlanAttack.ts:98-121` | The night 1000-1200 m FUP band is applied by day too | By day: a covered FUP (s66 para 8 c pp 307-308), SL "as close to the enemy as possible" (8 d p 308) | Apply the band by night only |
| IC4 | `hSumRow` `PlanAttack.ts:585-592` | Always passes | H is set so that the reorganisation ends before daylight (s68 para 13 b p 334; 11 f p 331) | Add the reorganisation time and warn when it runs past first light, as the crossing's Night row does |
| IC5 | `PlanSolve.ts:386-399` (no `hq` slot in `coy-def-*`) | Coy HQ is solved into the forward gap, level with the forward Pls | The CP is in the FDLs. Coy HQ is "in line with the depth platoon close to the main route" (s74 para 27 pp 396-397) | Add an hq slot level with the depth Pl |
| IC6 | `coy-def-three-up.json`, `PlanSolve.ts:546-551` | Three up is laid at 1.2 km, narrower than two up (1.5 km). Its Depth row passes at 250 m | Two up, one in depth. Three up "if the frontages are over extended", and the lack of depth must be weighed (s74 para 11 p 391). Depth always kept (s84 para 7 c p 447) | Depth row warns. Auto ranks three up after two up unless the frontage is > 1500 m |
| IC7 | `PlanFit.ts:619-643`; `terrainRule.across: approach.main` is never read; `layoutHints` "two-up, astride it" | An inter-Pl or inter-Coy gap may sit on the main approach | "Responsibility of defending an approach is not divided between two platoons" (s74 para 4 a (1) p 382) | Add an "Approach responsibility" row (warn). The layout stays as the annex draws it |
| IC8 | `PlanContext.ts:162` case '15', `check.posnFrontageM.15`, `PlanCheck.ts:727` | Own Coy on a canal is capped at 1500 m. `canal.coyThreeUpM` is never read | Coy three Pls up 1500-2000 m (s85 para 11 p 455) | Allow it on obstacle ground |
| IC9 | `PlanAdvance.ts:134-141`, `advance.bn.vanDepthM` | The night vanguard (IBB Fig 12, 500-600 m) is checked by day too | Day: leading Coy strung 1100-1400 m on the road, Bn 3-5 km (s61 para 7 p 261) | Add the day figures (D) and keep Fig 12 for night |
| IC10 | `bn-def-bua.json`; `PlanBua.ts:58`; `PlanFit.ts:232, 528-565` | BUA localities are 1500 x 700 m and the Localities row always passes. Fields of fire fail under 200 m. The > 30 % built-up warning fires on the BUA layout | Locality "of a limited size" (s52 para 1 c p 203). Fields of fire 50-100 m (s52 para 4 a (3) p 204). The 100 m Pl cap is the attack rule (s55 para 17 a p 229), wrongly applied to defence | Use a BUA guard: size to the BUA, 50-100 m fields of fire, skip the built-up warning |
| IC11 | `PlanBua.ts:34` | Counts `aslt.length*3`, so every Pl is taken as up | Each Pl needs three groups, one a reserve (s55 para 17 a p 229). At least a Pl on each side of a street (s54 para 8 p 224) | Count Pls up per Coy |
| IC12 | `pl-ambush-*` seeds | Geometry mode mirrors terrain mode: stop1 at y −175, out1 at −800, the L short leg at +85..130. The tab says "Stop 1 on the En side" | — | Flip the seeds (check at runtime) |
| IC13 | `MovementGuidePlans.ts:796`; `pl-ambush-v` | V: the second leg mirrors the fire line, so the two legs are parallel. The geometry seed narrows toward the En, but its note says it opens toward the En. No withdrawal party | V = two halves across the road with interlocking fire, plus "a third portion" covering the withdrawal (s44 para 18 c p 158) | Lay it as written |
| IC14 | `PlanSmallOps.ts:309, 523-524`, `MovementGuidePlans.ts:784` | An L on a straight road warns and loses 10 points. Text "an line" | L "on a strait stretch ... or a sharp bend" (s44 para 18 b p 158) | Drop the penalty and fix the typo |
| IC15 | `PlanSmallOps.ts:909` | Screen candidates nearer than 1000 m (AMP p 1.2) are dropped. The note claims a warning. The cite reads s84 | "Only as far forward ... as is necessary"; example knoll ~600 m (s73 paras 10-11 p 377) | Keep candidates and warn. Cite s73 |
| IC16 | `PlanWhatIf.ts:96, 475-477` | The En assault at 2 min / 100 m (the faster, chosen safety first) is labelled "deliberate attack" | 4 min against a well-prepared defence; 2 min only "in a day attack over favourable ground and against hastily prepared defence" (s114 para 35 k p 684) | Keep the safety-first pick but say which it is, or use 4 for a prepared defence. Your call |
| IC17 | `quickAttackRow` `PlanWhatIf.ts:618-626`, `enemy.quickAttackMin` | The En quick attack is timed by own drills (MIB p 89, IBB p 133) | Foxland Bn quick day attack with armour on a Coy locality "in 2-3 hours" (s113 para 20 b (3) p 664) | Show the En figure beside the own drills |
| IC18 | `PlanDoctrine attack.assaultMinPer100m` 4 (E) | Is the En's s114 figure taken for own | Own: Understanding Aprc p 20, 100 m / 3 min at night (`AprcMechs.ts:1118`) | Use the own figure |
| IC19 | `PlanWithdrawal.ts:384` | Mortars and CP withdraw at the time of denial | Mortars respond "till the last possible moment" (s92 para 1 p 484) and support the rear parties "till the last minute" (s92 para 13 p 488) | Mortars stay with the rear parties |
| IC20 | `bn-wdr-night.json` | No rear-party RV or embussing point | "A separate embussing point ... for the rear parties near their own RV" (s92 para 8 c p 487), "well forward" (para 14 p 488) | Add them |
| IC21 | `GroundGuideFrontage.ts:169` | Says "no En Bde frontage is printed" | s114 para 7 p 670: Div 80-120 km, Bde 20-40 km, Bn 7-10 km, Coy 1100-1400 m, Pl 300-350 m, Sec 70-90 m (s113 p 663 Bn 3000 m differs) | Add the En rows off the bund |
| IC22 | `pl-ambush-*`, `smallOps` | No reserve or covering group. No day / night difference: the fire line is always 30-120 m off the road | Reserve on the RV side (s44 para 8 c p 149), covering group (15 b p 156). Day: dispersed, longer ranges. Night: closer, point blank (16-17 p 157). Occupy by night (10 a p 150) | Add a reserve slot and a Day / Night chip |

## 2. Figures IC prints that the engine marks E / R, or lacks

- **Patrol** (`smallOps.patrol` `src`, `frvM`, `boundM`, basis R "no FRV or bound distance"):
  - IC prints bounds 550-750 m (s40 para 23 p 116) and FRV 400-500 m (s41 para 9 p 132). Change to D.
  - The same claim is in the `pl-patrol` note and PlatoonDoctrine.
  - Also in s40 paras 23-24 p 116, and not applied:
    - paces to the nearest 50;
    - RV 100-200 m off each bound;
    - night routes avoid hedges, defiles and wood edges, and prefer open ground.
  - The Bounds row prints the 650 m midpoint, not the route's own spacing.
  - Recce time at the Obj: an hour or more, then again from another direction (s41 para 10 p 132). The engine counts it once (`taskMin` 60).
- **Fields of fire** — `checkBands.fieldOfFireToObstacleM` [250, 700] E and `fit.killingGr.aheadM` [400, 1000] M. IC prints:
  - minimum 100 m, desirable 270-500 m (s72 para 6 b p 372);
  - Pl 400 m, killing 300 m (s77 para 2 p 425);
  - LMGs open at 500 m (s76 para 11 e p 417).
  - Use these for Coy and Pl plans. `PlanFit.ts:564` fails 100-199 m (IBB 200 m): warn there for Coy and Pl plans.
- **Mask posns** — `bn-def-canal` note says "400 m, E". IC prints 300-500 m (s85 para 28 b p 462).
- **DFs** — `df.perBn` 6-8, and its note calls 8-12 a reader's note. IC prints "8 to 12 DFs ... for a battalion deployed in defence" (s111 para 10 p 652). This is the book's print, not a margin note. Close DFs ≥ 400 / 500 / 550 m (s111 para 4 p 651).
- **Safe distances** — `df.safeDistanceM` lacks the 8 in How (500 / 550) and 120 mm Mor (550 / 550) (s109 para 11 p 641). `fireLiftM` could add IC s106 para 7 p 571 (200 / 400).
- **En** (Foxland, for the what-if and Ground Guide):
  - march 4.5 km/h by day, half by night, +1 h per 300 m up and per 450 m down (s113 para 20 c p 664);
  - reaction: Bn Coy 30-45 min, Bde 2-3 h, Div 4-6 h (s114 para 14 pp 671-672);
  - FUP out of direct fire, 15-30 min (s114 para 35 j p 683);
  - night frontages Bn 400 / Coy 200 / Pl 75 m (s114 para 35 l p 684).
- **Tank light** — 20-30 min after first light and before last light (s105 para 2 l p 551). Not used anywhere.
- **Wire timings** (s107 pp 588-590), protective minefield depth 250-300 m, lanes 8 m (s107 para 4 pp 596-599). Not used.
- **Coy defence items not laid or checked:**
  - 1-2 OPs a Coy (s74 para 8 a p 385);
  - a check post in line with the depth Pl (s75 para 27 p 411);
  - C Pen keeps at least one third in place (s76 para 28 p 423).
- **Attack:**
  - few phases and changes of direction by night (s68 para 3 a p 327): warn on night Ph 2 / 3;
  - a strong point with no assailable flank → penetration (s69 para 10 a p 343): add a caveat to the Form of attack row;
  - SL not under observed fire (s66 para 8 d p 308);
  - Assy beyond En field arty "when possible" (s66 para 8 b p 307);
  - the Fire lift row prints fixed 275 / 180 m text and always passes (`PlanSolve.ts:694`): build it from `liftRings`.
- **BUA attack and defence:**
  - rear threat, cut-off and ambush on the En line of retreat (s55 paras 16, 18 pp 229-230; s57 para 12 b p 241);
  - RR on the periphery covering tankable approaches (s57 para 4 p 238);
  - a few hundred m / 24 h in towns (s51 para 4 k p 199).
- **Advance:**
  - IC's Coy / Pl figures: s61 para 5; s62 para 18 a p 270; s63 para 15 p 276; night point Sec 100 / 140 m (s64 para 20 b p 286);
  - night rules: shorter bounds (s64 para 6 g (3) p 281), villages searched (para 15), flanking at Coy level on dark nights (para 11).
- **Withdrawal:**
  - thinning out a few minutes before denial (s90 para 15 b (1) p 479; s92 para 12 p 488);
  - the "no rearward move before" time (s90 para 15 a (2) p 478).
- **Ambush confirm list:**
  - an admin area if the ambush lasts ≥ 24 h (s44 para 8 e p 149);
  - 4 daylight hours to plan a recce patrol (s40 para 12 p 111).
- **Tank ambush:** keeps the 150 m vehicle kill zone. IC wants the whole column, plus covering and cut-off groups (s46 para 9 pp 172-173).

## 3. Cites to correct (content right, place wrong)

**Attack:**
- `PlanDoctrine.json:3560` `attack.phase2.fup2FromObj2M.src` and line 17 of `coy-attk-frontal/left-flank/right-flank.json`: "IC s67 p 333" → **s68 para 12 e (1) p 333**.
- `PlanSolve.ts:715`, `PlanCheck.ts:966` still print "E: beyond the last fire lift". The fallbacks `[600,1200]` are at `PlanCheck.ts:944`, `PlanSolve.ts:713`, `PlanPhase.ts:81`.
- Fire lifts: "s66 p305" → s66 para 7 e (1) pp 304-305 (120 mm and medium are on p 304).

**Water obstacles** (`PlanDoctrine.json`, `PlanCrossing.ts`, `PlanSolve.ts`, `PlanAttack.ts`, `PlanBuildTab.ts`, Aprc files, crossing recipes, tests):
- s70 para 2 → p 354;
- 4 c → pp 356-357;
- 4 e / f → p 357;
- 4 g → p 358;
- s70-71 → pp 354-366;
- s71 para 5 → p 361;
- para 7 → pp 361-362;
- para 8 → p 363;
- paras 12-13 → p 364;
- para 17 → p 365.

**Defence:**
- `fit.fieldOfFire.wantM` → p 372 para 6 b (the quote is only "Field of Fire", p 369).
- Screen cites (`PlanSmallOps.ts` ~10 places, `smallOps.screen`, `coy-screen.json`), each one page late: paras 10-11 p 377, 13-14 p 378, 15-16 p 379, 18 p 380.
- Rev slope recipes: s78 pp 429-431 (3 a / b p 430, 4 b / d p 431).
- `readyBy.coyPosnH`: the words are "depending on the degree of enemy interference", not "ground" (s75 para 1 p 399). `PlanOrbat.ts:491` calls it IBB and uses the Coy figure for a Bn (`bnPosnH` exists).
- `PlanCrossing.ts:707` p 452 → p 451; `:669` para 3 d → para 1 p 448.

**Patrol and ambush:**
- "IC s42 para 23 p 116" → s40 para 23.
- "IC s41-43 pp 128-146" / "s41 pp 128-133" → pp 130-145 / 130-134 (`PlanDoctrine.json` ~4193, 4199, 4249, 4322).
- `PlanBuildTab.ts:3660` credits IC s44 p 152 with "400-1200 m", which IC does not print (`outlyingM` is E).
- Ambush layouts "pp 156-158" → s44 para 18 pp 157-158.

**Withdrawal:**
- `PlanWithdrawal.ts:242` s92 para 3 → p 484.
- Lines 291 / 393 / 444 s93 para 3 → p 489. Its text is mines and booby traps in the abandoned posns, not nuisance mines on the roads.
- s91 paras 6-9 → p 483.
- `PlanDoctrine.json:6160`, `PlanWithdrawal.ts:348` para 14 → p 488.
- `cleanBreakMinM` p 482 c → p 481.
- IC could be cited beside IBB for the intermediate posn hop (s91 para 3 b p 481) and the covering Pl (s92 para 11 p 487).

**Foxland:**
- `OcokaDoctrine.json:188-189` Bn rows p 658 → p 663 (s113 para 20 a); `:190` mountain Bn → p 665.
- `PlanDoctrine.json:390` same.
- `:301` `enemy.defaultType` "s114 p 663" → s113 para 20 b (1).
- `:2900` "own: LOE ... (IC p 684-685)" is the Foxland Bn (s114 para 35 o).
- `PlanSolve.ts:775`, `PlanCheck.ts:844` "from IBB Annex U / IC s113".

**Other:**
- `OcokaDoctrine.json:218` "IC s55" → s55 para 17 a p 229 (attack).
- `OcokaDoctrine.json:168` section weapons "RPG-7 / Energa": the Sec has 2 LMGs; the RLs are in Pl HQ (s2 para 3 b p 6).
- `Symbols.json 10120410` "IC s46.6b-c" 500 m: IC prints RPG-7 180-275 m, Energa 70-120 m.
- `IpbDoctrine.json:362` frontal discard: s15 paras 11-12 b p 33 is the Coy encounter battle; cite the context.

**Code fallbacks that disagree with the doctrine:**
- `PlanAttack.ts:369` uses 30 min in the FUP and `:410` uses 15 min; IC says 5 at most (s66 para 13 f p 312).
- `PlanCrossing.ts:448` uses 16 boats / 96 men; the doctrine says 22 / 130.

**Small bugs (not IC):** the Coy two-up and one-up Depth rows say "no doctrine depth (E)" though `size.coy.depthM` 600-800 exists.

## 4. Books differ (your choice; keep both side by side)

| Topic | Engine (book) | IC |
| --- | --- | --- |
| Main guard gap by night | 300-400 m (IBB p 149) | ≥ 400-450 m (s64 para 6 c p 280) |
| Vanguard depth by night | 500-600 m (IBB Fig 12) | ~450 m (s64 para 6 b p 280) |
| Tank fire by night | 800 m (IBB p 214, NVD) | 450 / 550 m by full moon (s64 para 22 e (2) p 293) |
| Follow-up Coys when the assault leaves | to the FUP (IBB p 204) | to the SL (s68 para 12 e (7) p 333) |
| Tank assault line by day | 150 / 250 m (IBB p 187) | no assault line by day (s65 para 2 r p 298) |
| Tanks' FUP | no common FUP (IBB p 214) | same, parallel or converging axes (s105 para 21 a pp 554-555) |
| Report lines vs bounds | water lines as RLs (OoW glossary) | bound = tactical feature, halt; RL = no tactical significance (s58 paras 4, 6 pp 242-243) |
| Canal / ditch Coy | one Pl up (IBB Annex V) | three Pls up 1500-2000 m (s85 para 11) |
| `bn-def-extended` fwd Coys | no Pl in depth (IBB App 7) | depth at Coy level always kept (s84 para 7 c); IC Annex R is an image, so read it first |
| Field of fire minimum | 200 m (IBB) | 100 m (s72 para 6 b) |
| Screen distance | ≥ 1000 m (AMP p 1.2) | as far as needed; knoll ~600 m (s73) |
| FUP time | 5 min (s66 p 312) | 2 min in a Coy quick attack (s15 para 12 c p 34) |
| En march / climb | IPB 4 km/h, MW climb | En 4.5 km/h, +1 h / 300 m (s113 para 20 c) |
| En reserves | IDD p 5 | s114 para 14 |
| Own Div on an obstacle | 60-80 km (IC s113 para 4 c p 658, the Indian Div) | keep or drop: declared |
| Withdrawal embussing | Coy EPs (IBB) | normally one EP a Bn (s92 para 8 c) |
| Convoy packets | 5-10 vehs (MovementDoctrine, no book) | 4-5 (s32 para 6 p 76) |

## 5. What agrees (no action)

**Defence:**
- alt posns 200-300 m;
- C attk Coy 30 min / Bn 1 h;
- short-range AT 500 / 600 m ahead;
- Coy / Pl / Sec never extended;
- canal and ditch dimensions;
- the reverse-slope rules;
- the higher bank;
- NBC rows noted as not applied;
- IC prints no own Coy frontage on normal ground, so AMP 1200-1500 m stands.

**Attack:**
- fire lifts 450 / 360 / 275 / 180 m;
- FUP ≤ 5 min;
- drift 2 × width;
- 300 m of bund a Coy;
- En Pl 275-300 m;
- A, B at H, C at H+20;
- H = first boats in;
- En minefield 600-900 m recorded beside IBB.

**Advance:**
- 800 m flank clearance;
- encounter Coy 30-45 min / Bn 1-2 h;
- gaps in time;
- night flank drill 90°;
- standoff LP 350-400 m;
- standing patrol 1000-1500 m;
- ambush RV 750-900 m.

**Others:**
- s15.12 b(1)-(3);
- s46.6 weapon ranges;
- withdrawal checks (37);
- the IBB embussing 1500-2000 m (rightly IBB, not IC).
