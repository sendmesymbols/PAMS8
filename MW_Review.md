# Mountain Warfare (GSP-1973) vs Intelligent Deployment and Ground Guide

27 Nov 2026. Book: `Material/Literature/1. Books/8. Mountain Warfare.pdf` (Mountain Warfare, Low and High Altitude
Operations, GSP-1973, 2003, RESTD; 320 PDF pages, ClearScan OCR). Read in full again today (three readers, every quote
grep-checked against the text layer). Ref id **MW** (Gun / Admin: `mw`). Digest in memory `mountain-warfare-doctrine`.

The book was first read on 24 Nov 2026, and its findings went into `Doctrine_Review.md` (R8-R11, R26-R27, R39, R56-R59,
R67-R68, R84-R88, R117-R119, R165, R238-R247, R260, R267). Most of those were applied then. Today's review checked:
- what was applied against the pages;
- the page and section cites, which `verify.py` never checks in `src` strings, notes and code: 201 of them;
- the mountain behaviour of the Intelligent Deployment tab and the Ground Guide.

**Section numbers.** MW numbers its sections 1-25 straight through the book: s6 Advance, **s7 Attack**, **s8 Reduction of
a Strong Point**, s9 Salient, s10 Infiltration, s11 Log, **s12 Defence**, s13 SP Defence, s14 Salient Defence, s17
Recycling, s18 Uphill / Downhill Firing. Annexes: E Route card p 309, F Timed programme p 311, H Animal transport p 318.

**Page map** (printed = PDF - n). n drifts because pages are missing:

| PDF pages | n |
|---|---|
| 5-37 | 4 |
| 38-42 | 3 |
| 43-71 | 2 |
| 72-96 | 1 |
| 97-98 | -1 |
| 99-111 | -2 |
| 112-140 | -3 |
| 141-175 | -4 |
| 177-178 | -9 |
| 179-206 | -11 |
| 207-221 | -12 |
| 222-244 | -15 |
| 245-297 | -16 |
| 298-320 | -18 |

- **Missing printed pages:** 34, 40, 70, 96-97, 100, 114, 144, five of 180-185, 188-189, 218, 234-236, 260, 314-315.
- **Pages with no number in the text layer:** pp 1, 21, 35, 53, 75, 77, 81 (pdf 82), 91, 99, 118, 131, 203, 207, 245, 273,
  289, 305, 323. Cite these as "pdf N".

## Status

**Fixed and tested** (F1-F10 below). Not committed.

Checks run (after N1-N6 were built, same day):
- `tools/planbuilder-test/mw.mjs`: 47 checks; new `salient.mjs` (37), `tools/ipb-test/mtnapch.mjs` (20) and `tools/sitefinder-test/gunsec.mjs` (19); `arty.mjs` 53.
- All 26 planbuilder suites pass (with the Desert session's `dw.mjs`), and planbuilder-fixes.
- ipb (14 suites), sitefinder run / tools / gunsec and aprc (354) pass.
- ocoka-test: 43 / 44. The one failure is "crop mix", a data check that was failing before today.
- `verify.py --write` finds every new MW ref (pp 46, 52, 78-79, 152, 176, 191, 240-244, 311-313) in PlanDoctrine, IpbDoctrine and GunDoctrine.
- tsc shows no errors in the touched files.
- In the app (:6547) on real tiles: near Muzaffarabad the 🎯 panel put a towed 122 mm Bty in 3 section sites within 1.9 km, each 130-240 m off a named road; on the plains the same gun keeps the conventional area. At Mingora (Swat) the En's approaches read "Valley", floors about 2.2 and 3.2 km. The strong point rows were not driven in the app (geometry and synthetic ground in mw.mjs only).

**Cite audit:**
- Ground Guide: 68 of 71 cites were right. The three wrong ones are fixed (F9).
- Plan Builder: 96 of 130 were right. All the errors were labels or overstated inferences, none a wrong page; fixed in F4-F8.
- No figure was missing from the book.

**Built on your "Build N1-N3" and "Build N4-N6" (27 Nov 2026):** see §1b. **"Build N7-N12" (same day, usage limit reached before the write-up):** N8-N9 (Ground Guide Air tab in mountains and mountain weather notes; `tools/ipb-test/mtnair.mjs` 23), N10 (`PlanAD.adDefileRows`: AD over the defiles on the attack route, MW p 247), N11 (Mines in time on mountain ground: MW p 195 pioneer rates, pp 149-150, 171) and N12 (recipe `div-def-mtn-valleys`, family Div Def (Mtn): reserves split per valley, GSP pp 122, 176; MW pp 164, 169; `mw.mjs` 59) built and tested; N7 (mountain admin areas) was still being built and is not checked.

## 1. Fixed in this session

| # | Where | Was | Now (book) |
|---|---|---|---|
| F1 | `PlanAttack.attackTimes`; `PlanDoctrine terrain.kinds.mountain.uphillCoverMinPer350m` (60, D) and `slantFactor` (D) | The assault from the SL to the Obj was timed on the horizontal distance, in mountains as on the plains. The climb was charged on the approach only. | **Annex F pp 311-313**, "timed programme in hilly terrain". Uphill, the troops cover the slant distance: the map distance times the factor for the angle of slope. That factor is 1 / cos: 30° 1.16, 45° 1.41, 60° 2.00, 70° 2.93. The covering fire is lengthened by one hour for every 350 m of climb from the SL to the Obj, and the safe distances are unchanged. Each fire lift now comes at (slant − safe distance) / 100 × the rate + the climb, for phases 1, 2 and 3. This applies on mountain ground, with the elevation, going uphill only. The step reads "(uphill N m, slant)", and the H-hour sum row names Annex F with the factor and the minutes. On the test hill (282 m at 17°) the Obj time went from about 29 to 78 min. |
| F2 | `PlanAttack.phase3Row` | A three-phase Bn attack with no reserve left sends A and B Coys back from Obj 1 onto Obj 3 the same night. In mountains nothing flagged it. | **s17 para 3 c p 210:** troops recycled in less than 48 h "could not deliver the goods", and 72-96 h after the attack holds for planning. Para 4 a p 211: timings may have to be doubled. Para 5 d p 213: troops to be recycled are not taken below 80 %. *Ph 3 timing* now **warns** in mountains when the Ph 3 Coys are recycled. Its fixes: D Coy for Ph 3, a separate attack 72-96 h later, or a lighter Obj 1. Not on the plains (IBB p 189: each Obj a firm base), and not when D Coy takes Obj 3. |
| F3 | `PlanContext.groundNotes` (mountain *Ph 2 / Ph 3 timing*) | "a unit used not recycled before 48-72 h (OOW2 p 60; MW pp 210-215)" | The 48-72 h is the rest for a unit sent to **another sector**, plus its travel (para 6 e p 215). The note now says: less than 48 h could not deliver, and 72-96 h after the attack holds for planning (para 3 c p 210). OOW2 p 60 stays as "fresh troops for each phase where they can be had". |
| F4 | `PlanMountain.ts`, `bn-def-mtn-*.json` (5), `bn-attk-mtn.json`, `PlanDoctrine.json` (25 places) | "MW s1 …" for the attack and "MW s2 …" for the defence. In MW, s1 is the Introduction and s2 the Environment. The header also said "GSP 2016". | Attack is s7 and defence s12. The strong point attack (p 109) is s8. Paragraph labels were corrected: p 81 para 7 **b** (2)-(4), not 7 c; lateral ridge 13 a (1) / (2); pass 14 c (1)-(3); fire base s7 paras 28-29 **pp 93-94** (p 95 is only the weapons list). The book is GSP-1973 (2003). |
| F5 | `PlanContext` l. 63, `PlanFit` l. 1334, `PlanDoctrine enemy` note | "the default enemy in mountains is infantry (MW pp 238-239)", and "most attacks by infantry at night (MW pp 79, 82)". | Neither page says so. The book's ground for it is **p 2 para 6**: "Only the infantry can occupy the vital high grounds". p 238: armour is confined to roads and tracks. p 239: be "extremely cautious" in declaring mountains non-tankable, since tanks can work in limited numbers in valleys. p 82 para 10: most attacks go in at night or in poor visibility, with no mention of infantry. The default (infantry) is unchanged. |
| F6 | `PlanContext.groundNotes` (*Reserve reach*) | "above Bn level not from one central place" | "**upwards of** battalion level from one central location" (p 169), so the Bn is included. The note now says "from Bn level upward". |
| F7 | `PlanFit` (*Dominates the approach*), `PlanDoctrine` (3 src) | "MW pp 147-179" | The rule is on **s12 para 2 p 147**: "occupying dominating features astride it and on its flanks". The old cite spanned three sections. |
| F8 | `PlanEnFront.ts` (*En front*); `enfront.mjs` | "the plan sits in a salient **of the En front**" | MW p 124 para 2 a: a salient is a projection of **own** ground toward the enemy, and an enclave for him. The plan the En line wraps on both flanks is therefore in *our* salient. Para 3 c p 126 still applies. |
| F9 | `GunDoctrine.json` `access.maxM` src; `IpbTemplates.json` `def-mtn` p3; `GroundGuideIpbApchView.ts` (Rates) | "gun areas are found near roads and tracks (MW p 240)"; "MW p 84: the line runs across every approach"; "0.5 by night" | p 240 says gun areas near the roads are **scarce**: towed guns move on roads and tracks only, a single gun or a section goes near a hairpin bend. p 84: the En defence is generally a continuous line. p 148 para 3 c: only the dominating features covering the main approaches are occupied. p 81: "0.5 to 1 kilometre per hour" by night; the label now reads 0.5-1 (0.5 used). |
| F10 | `PlanDoctrine` | none | Two new figures, both basis D and checked by verify.py: `uphillCoverMinPer350m` 60 (p 313, p 312), and `slantFactor` with the book's table (the 65° row OCRs as "0.37"; it is 2.37). |

## 1b. Built: N1-N3

| # | Where | What it does now (book) |
|---|---|---|
| N1 | `GroundGuideIpbCorridors.mountainApproach` / `mtnHardestIndex`; `GroundGuide._apchCompute`; `GroundGuideIpbApchView.ts` (cards, Read As, Copy as Text); IpbDoctrine `mountainApproach` | On mountain ground (IpbTemplates `mountainTest`: 400 m of rise within 5 km) each approach in tab 3 is typed from the 30 m elevation read square to it every 100 m: **valley** / **nullah** / **ridge line** / side slope / mixed, with the book's words. Valley and nullah are MW s7 para 4 a p 78. Ridge: attack along the gradient, ridges and spurs (p 79), and routes follow ridges, not gullies (p 46). On the En's options, valley and ridge approaches get LPs (p 52). Of two or more, the difficult one is marked "normally lightly held" (p 79), worded for whose options are read. How it reads: a side rises or falls where it stands 30 m above or below the way. A fall counts within 1.5 km (ridge). A floor's sides are looked for out to 5 km, so a broad valley reads as a valley; with 1.5 km only, the Swat at Mingora had read as a side slope (fixed the same day). A floor 500 m wide or less is a nullah. The thresholds are E, decided and searched. Every line says "read from the 30 m elevation: confirm on the ground". |
| N2 | GunDoctrine `areas.sec`, `mountains.bySection`; `GunDeploymentFind.findGunSections` / `gunTaskFor` / `findGunSites`; the 🎯 panel; `PlanArty`, `PlanBuildTab` (G) | Towed guns on mountain ground go **by section**. A section site is 2 guns in 200 × 100 m (MW p 240; FM 6-50). A Bty is in 2-3 places (p 244): sections at least 300 m apart (ATP 3-09.50 p 2-2) and within 2 km of the first (E, decided). A Regt is three such Btys. Light guns (105 mm Pack How) keep the conventional layout (pp 241, 244); SP guns are not changed. Hairpin bends are not read from the data, and the sites are confirmed by recce (p 240). In the Plan Builder the Gun area row is unchecked on mountain ground until G, which lays one PAA outline per section ("Fd Bty Sec 1/2/3"). Left: Check my plan reads back only Sec 1, and Arty reach measures from Sec 1. |
| N3 | `PlanMountain.readFeature`, *Strong points* (every mountain defence) and *Objective* (the mountain attack); PlanFit and PlanCheck pass the elevation; PlanDoctrine `mountain.strongPoint` | Each Coy posn's top on the 30 m elevation is its **Pl SP** site, named with where it lies in the posn and its height above the posn's lowest part. Level ground is said so. Higher ground 10 m or more above that top, within 600 m and outside every own posn, means the SP is **not on the most dominating feature**: the row warns with a Why and a Fix (MW s12 para 9 p 152; one third always in the SP, s13 p 176). 600 m is E (snipers hit a man at 600 m, MW p 191); 10 m is M (the grid's height step). The mountain attack's Objective row is read the same way (MW s7 para 3 p 78). Without the terrain both rows stay unchecked. |

| N4 | Recipes `bde-def-mtn-salient` (family Bde Def (Mtn)) and `bde-attk-mtn-salient` (Bde Attk (Mtn), on MW Fig 4 p 131); `PlanMountain` salient rows; PlanDoctrine `mountain.salient` | **Defence** (s14 pp 178-179): the two shoulders strong, a Bn each; the arch at the tip held lightly by a Coy as Pl SPs; the Bde reserve central behind it (interior lines); depth localities planned (dashed); an FDL from shoulder to shoulder. The rows *Shoulders*, *Arch*, *Reserve central* and *Depth* pass as laid and warn on a bad variant; *Salient* is a note (more troops than a linear border, fire from three sides, a Bn per major approach, p 179). **Reduction** (s9 pp 124-133): one Bn fixes the arch; the main attack goes onto a shoulder from the flank (87° off); a supporting attack; a Coy with the pooled Cdo Pls infiltrates to block the base; three Assy Areas; a reserve on the main axis. The rows *Base or shoulder*, *Front fixed*, *Infiltration to the base*, *Assembly* and *Reserve per axis* pass as laid; *Deception* and *Arty and DAA* are notes (pp 132-133); *Objective* is read on the elevation (N3). Three settings are M: the reserve within 20 % of the shoulder span, the arch within 1.5 km of the tip, a flank 45° or more off. The solver's *Reserve share* now skips Coy-size slots in a Bde or Div plan. Left: the posns face forward, where the book has the shoulders face out as well (the note says so); only Fig 4 (envelop the base) is built, with Fig 5 (a wedge) and "penetrate a shoulder" named in text. |
| N5 | `PlanFit` row *Weapon angles* (mountain defences, beside *Dominates the approach*; Check my plan through the fit); PlanDoctrine `terrain.kinds.mountain.weaponAngles`; OcokaDoctrine `observation.mountain` text | Each forward posn's angle down (or up) onto the main approach where it passes in front, from the 30 m elevation. A MG on its mount elevates 6° and depresses 8.5°; the 75 mm RR elevates 30° and depresses 5° (MW s18 para 7 d p 221). Past the RR's 5°: a dead arc (p 224). Past 8.5°: the MG cannot depress either. Uphill past 6°: the MG on its mount cannot elevate. Warns with Fixes: RRs in the foothills on the lower spurs (p 225), shoulder fire not beyond 400 m (p 223), the MG mount's front leg lowered with sandbags (p 224) or the AA mount uphill (p 222), range cards with the angle and range (p 225). The Ground Guide's mountain observation note adds the range factors (divide by 1.02 / 1.04 / 1.06 / 1.10 at 10 / 15 / 20 / 25°, p 217). |
| N6 | `PlanContext.groundNotes` row *Strong point drill* (every mountain attack: build, fit, Check my plan); the mountain *Breach* row; PlanDoctrine `terrain.kinds.mountain.spDrill` | The strong point drill (s8 pp 101-121), in order: isolate the SP and attack only the bunkers needed, by the most difficult approach, rocky nullah beds being hard to mine (pp 104-105). The path-marking group (1 Aslt Engr NCO, 1 Aslt Engr Sepoy, 3 riflemen) crosses in single file and blows two wire lanes a Pl by Bangalore torpedo (pp 106, 113). Troops form up in groups (p 117). The guns and mortars shift to depth as the path markers enter the minefield, the fire base firing until the torpedoes (p 117). The RL shot stops the direct fire (p 119); the success signal sends the stretcher bearers (p 120). The reserve follows close, timings liberal (p 105), rehearsed on a replica (p 106). By night the row is "confirm the drill"; **by day it warns**: almost all SP attacks go in by night (p 103), so soften on a broad front (p 116). No time is printed for the drill, so none is added to the H-hour sum. |

## 2. Checked and following the book

These were verified page by page today. Most came from the 24 Nov round.

**Movement:**
- Foot in mountains: 3 km/h by day and 0.5-1 km/h by night, + 30-60 min per 300 m of ascent and per 600 m of descent (p 81, pdf 82; also p 48 and p 309).
- Ground distance = map distance + 1/3 (p 48).
- These hold in the Decision tab, the speed engine, the what-if, the attack approach and the Night March.

**Snow and seasons:**
- Snow closure above 2500 m (p 259).
- Snow slides over 35°, 25° for 2-3 days after a fall, wet slides on 15-20° (pp 281-282).
- Above 2000 m winter snow (p 1).
- Ice and snow tables (pp 68-69, 74).

**Air:** helipads ≤ 4° (emergency 4-10° and 4-20°, p 256); DZs scarce, heliborne targets (p 258).

**Fire support and AD:**
- AD on defiles, gun areas and log installations, from the dominating features (p 247).
- Guns by section in 2-3 places, concentrations not barrages, OPs in tiers (pp 240-246). These are notes only; see N2.

**Defence:**
- Frontages large, gaps large, depth reduced, reserves split (pp 148, 150).
- First layout three up, not a Bn ring (p 151).
- Tiers and strong points (p 152).
- Ridge in nullahs 1/3 : 2/3 (p 154); penetrant ridge (p 155); lateral ridge (pp 156-157); pass (p 158); valleys (pp 161-162).

**Attack:**
- Objectives (p 78); envelopment with frontal fixation (p 79); limited frontages (p 79).
- More than 3 : 1, reached in sequence (p 80); several directions (p 80).
- A reserve per axis and liberal timings (p 82); night or poor visibility (p 82).
- Multidirectional attack (pp 83-84); no classic FUP (p 85); FUP beyond MG range with NVDs (p 228).
- No minefield breach, single file, two wire lanes a Pl (pp 86, 106, 113); his minefield 100-150 m deep (p 106).
- Fire base: one target per two weapons (p 94); five Pls against a strong point (p 109).

**Enemy:**
- He softens up selected posts, attacks the feature covering the approach, and infiltrates to cut off reinforcement (pp 164-168).
- His line is continuous, so the attack penetrates (p 84).

**Mules:** 160 lb; plan 65 kg in hills, 74 kg on normal ground; 16 mi a day, 8 under load (pp 319-321).

## 3. Needs: not built

| # | What | Book |
|---|---|---|
| N1 | **Built (§1b).** **Ground Guide: name the mountain approaches.** On mountain ground, tab 3 should call each approach river / valley, nullah or ridge line from the 30 m elevation, with what the book says of each. Valley: broad, has the road, obvious, well covered. Nullah: narrow and winding, the infiltration route, where he ambushes. Ridge: easy to fight on, hard to maintain, a narrow frontage, attacks in echelon. The difficult approach is normally lightly held. Attack along the gradient, ridges and spurs. Routes follow ridges, not gullies: a 3 km ridge detour beats a 600 m down-and-up. LPs go on the valley and ridge approaches. | pp 78-79, 46, 52 |
| N2 | **Built (§1b).** **Gun areas in mountains by section** (R119, open since 24 Nov). The G key (`GunDeploymentFind`) fails any area that cannot take the conventional 6-gun 400 × 200 m layout (`room.minShare` 0.7). MW says towed guns go a single gun or a section near hairpin bends, and a Bty deploys by sections in 2-3 places. Light guns away from the roads keep their normal layout. Recce on the ground confirms it. | pp 240-241, 244 |
| N3 | **Built (§1b).** **Strong points checked on the ground.** *Strong points* is "unchecked" in every mountain defence. With the elevation it could test that each Coy posn holds a Pl SP on its most dominating feature, as the rallying point and the pivot for counter-attack. Other rules to check: one third always in the SP (p 176); the SP's bunker count (pp 174-176; Annex G: a Coy SP roughly three times a Pl SP, p 317); staying power of 7 days isolated (pp 151, 166) and 30 days for the SP. | pp 152, 166, 170-177, 316-317 |
| N4 | **Built (§1b).** **Salient plans.** Defence: strong shoulders and a lightly held arch; key features as Pl / Coy SPs biased to the shoulders; a Bn per major approach in the important sub-sectors, wider elsewhere; reserves central; it takes more troops than a linear border. Attack: fix the front, envelop the base or penetrate a shoulder, infiltrate; assemble at several places; deception (fake log / arty build-up, fake signal net); split the arty and the DAA. | s14 pp 178-179; s9 pp 124-133 |
| N5 | **Built (§1b).** **Uphill and downhill fire.** Divide the range by 1.02 at 10°, 1.04 at 15°, 1.06 at 20° and 1.10 at 25° (p 217; the rest of the table is on missing p 218). Weapon limits: MG elevation 100 mils; 75 mm RR elevation 500 mils and depression 83 mils (p 221), with RR shoulder fire not past 400 m (p 223). So RRs belong in the foothills (pp 224-225). Range cards carry angle and range beyond 200 m / 25° (pp 225-226). This bears on the Ground Guide's fields of fire and on the RR row's siting. | s18 pp 215-226 |
| N6 | **Built (§1b).** **Strong point attack drill.** A path-marking group (1 Aslt Engr NCO, 1 Sepoy, 3 riflemen) crosses in single file and blows two wire lanes (p 113). Guns and mortars shift to depth as it enters; the fire base fires until the torpedoes go (p 117); the RL shot stops the direct fire (p 119). His minefields are thin in nullahs, and rocky nullah beds are hard to mine, so they make approaches (pp 86, 105). The Pl is organised in 4 groups (pp 109-112). | s8 pp 101-121 |
| N7 | **Mountain admin areas** (R245). Near water and fuel; downwind; part way up the slope; free of slides; on rock or gravel; defensible; near airstrip or helipad ground; room to disperse. Stocks in each sector. AT from the road head onward, with portering as the last resort. | pp 263-267 |
| N8 | **Air tab in mountains.** Mask landing sites from his view, take off into the wind, avoid dry dusty ground (pp 255-256). Strafing and bunker-busting munitions are not effective (p 257). Heliborne troops are less hampered by low cloud (p 258). | pp 253-258 |
| N9 | **Weather notes.** Fog in the valleys, nullahs and river beds until 0900-1000 (p 229). Poor visibility is frequent above 2000 m (pp 229-230). Snow above 2500 m hides tracks in winter (p 298). Fracture starts on convex slopes; cross high on concave ones (p 71). Flash floods in nullahs (p 9). Storms travel east (p 10). | Ch 4, Annexes B-C |
| N10 | **Rear area.** The vulnerable points in mountains are gun areas and wagon lines, C Pen posns, bridges, defiles, landing grounds, helipads and transformers (pp 232-233). He sets off slides to block roads (p 233). Build diversions for important bridges in advance; convoys carry AA weapons (p 237). These could be PlanAD VPs on mountain ground. | s21 pp 232-238 |
| N11 | **Mines in time in mountains.** Pioneer Pl rates per hour (day / moonlight / dark): AT 130 / 88 / 65, AP and mixed 65 / 44 / 33 (p 195). Minefields on slopes wash away (p 149), and mines are weak in snow and rock (p 150). | pp 149-150, 195 |
| N12 | **Mountain Div** (= IDB N4). The reserve split to guard the valleys; one Bde up in the attack; approach by night, attack at first light. | GSP pp 122, 174-176; MW pp 82, 169 |

## 4. Where the book differs (with itself or another book)

- **Mine shoes.** p 86 says no breaching and no mine shoes in the attack, but p 198 trains engineers to breach "with and without mine shoes".
- **Annex E route card.** The worked example's climbs imply 37 and 52 min per 300 m, but its descents get only about 2 min, below the book's own 30-60 min per 600 m. The engines use the rule, not the example.
- **Annex H totals.**
  - An ammunition lift prints 123 mules, but its rows add up to 101.
  - The weekly ration is 5404 kg on p 322 but 5600 kg on p 323.
  - The book converts 160 lb as 75.5 kg; it is 72.6 kg.
  - The planning loads (65 / 74 kg) are what the engines use.
- **Climb rate, MW vs IC.** IC s113 para 20 c (2) p 664 gives the En infantry 1 h per 300 m up and 1 h per 450 m down; MW gives 30-60 min per 300 m / 600 m. MW stays his earliest, and IC is told beside it (as before).
- **Central reserve.** p 82 says a central reserve is of little value in the attack. p 179 says the salient defence keeps its reserves central (interior lines). Both are right for their case.
- **Acclimatisation.** p 12 requires it for ops above 2500 m, and p 291 says above 2000 m practically all un-acclimatised troops are affected. The digest had cited p 294, which only says mountain sickness can come at 2500 m.
