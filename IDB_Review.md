# GSP-1947 Infantry Division in Battle vs Intelligent Deployment and Ground Guide

27 Nov 2026. Book: `Material/Literature/1. Books/GSP - 1947 Inf Div in Battle.pdf` (2001, RESTD, 205 pp; the printed page
is the PDF page; real text layer, not encrypted; Annexes A-H are scans on pp 198-203, Annex J text on pp 204-205). Ref id
in PlanDoctrine is **GSP** (AdminDoctrine: `gsp`). Read in full, the annex drawings rendered. Digest in memory
`idb-inf-div-doctrine`.

The book is the Div and Bde level book. Most of the engines work at Coy and Bn level (IC, IBB); this review covers what
the engines do at Bde and Div level, and the enemy figures the Ground Guide reads.

Already cited before this review (14 refs, all checked by verify.py): p 83 (En reserves, kept as the En's, not own),
p 86 (Bde night assault 1100-1500 m), p 86 para 12 a (open ground wider by day), p 86 / 87 (mountains narrower), p 87
(desert 3000-4000 m), p 119 (Bde on a DCB 8000-10000 m), p 183 (covered accommodation to medical units and workshops).

## 1. Fixed in this session

These are files the IC session does not hold.

| # | File | Was | Now (book) |
|---|---|---|---|
| F1 | `Recipes/div-def-two-up.json` | Main posn + reserve only. | Three echelons (s23 paras 5-13 pp 104-106; OoW Vol I Annex A p 102). Protective detachments are covering troops and screens (p 105 para 7 c): a C Tps group on each forward Bde's axis 4 km ahead of the FDL, inside a 10 km Security Zone (`00000161`). Distances are basis O (PlanDoctrine `securityZone`). The screens are left to the Bde and Bn plans (p 106 para 11). |
| F2 | same | The Div reserve was an infantry Bde timed on foot, and *Reserve reach* warned at 129 min. | The Div reserve is an Inf Bde, the Armd Regt or its bulk and the LAT Bn, commanded by the Bde Comd and given transport from the Div pool (s27 para 3 p 122), as strong in armour as possible (p 107 para 19 a). An Armd Regt point is added, the AT Res is labelled LAT Bn, and the reserve is timed mounted (*Reserve reach* now passes at 26 min). |
| F3 | same | There were no counter-penetration posns at Div level. | They are planned and prepared at the outset and occupied when the threat warrants (pp 108-109 paras 20-22). The Div reserve occupies them (p 123 para 5 b (5)). One Bn-size posn is drawn planned behind each forward Bde, 1 km behind its rear edge (`cpen.behindFwdM.bde`, E). Their number and size are E: p 109 prints none. |
| F4 | `Recipes/div-def-three-axes.json` | Same gaps as F1 and F3. | Same three echelons: C Tps on all three axes, a Security Zone, and C Pen posns behind the outer Bdes (the armour covers the centre). The note now also cites the DCB rules (three Bdes up, p 120-121; at most two Div-size approaches without more resources, p 119; the Div reserve, p 122). |
| F5 | `Recipes/bde-def-two-up.json`, `bde-attk-two-up.json` | Notes only. | The DCB case is named (Bde up to 8-10 km, Bns three up, pp 119-121). The attack note adds that each Bde needs a clear axis (p 86) and the desert and mountain frontages (p 87). |
| F6 | `MoveDoctrine.json` `road.space.assyKm2` | The Inf Div assembly figure was E 80-110 map squares, four times the book. A drawn Inf Div area of 20-40 km² was judged "too small". | Inf Div fighting echelons are 20 map squares and the DAA 15-20 (Annex J para 1 h p 205), both basis R. Inf Bde 6-7 and Bn 2 are now E: a third each step down, since no figure is printed. The road space on two axes is 112 km by day and 56 km by night (para 1 g), and an Inf Div needs 10 trains (para 1 f, `rail.trainsPerFmn.inf_div`). `MoveReports.assySpace` now prints a single figure once ("needs 20"). |

Tests run after the edits:

- planbuilder: recipes 299/0, solve 1144/0, gaps 29/0, gaps2 40/0, arty 46/0, ad 28/0, fit 43/0, shape 11/0, enfront 46/46, check 121/0.
- moveplan: 70/70.

The edits were checked in geometry mode and then in the app (see §2).

## 2. Items from the IC session's files (applied once it said "done")

After the IC session freed its files, items H1-H5 and H10 were applied. H7 and H8 were applied as notes only; H6 and H9 are still open. Each row's status is given first in its last column.

Tests after these changes:

- New file `tools/planbuilder-test/idb.mjs`: 31 checks, all pass. It covers the Div defence echelons, the reserve wording, the second-line troops row, the Indian reserves refs and the Move Planner figures.
- All 24 planbuilder suites pass, and so do the ipb suites (decision, review, template, corridors, frontage, fire, run), moveplan and planbuilder-fixes.
- `verify.py --write` found every new GSP ref on its printed page (p 72, p 83).
- `tsc` is clean on the TS files touched.
- In the app (:6547): a Div Def two up was placed and showed the SZ, C Tps, dashed C Pen 1 / 2 and the Armd Regt in the reserve. A Bn Def with a Rangers Wing showed the "Second-line troops" warn.

| # | Where | What the book says | Status / change |
|---|---|---|---|
| H1 | `IpbDoctrine.json` `decisionPoints.reserves.indian`; `IpbTemplates.json` `phases.defensive.res`; `GroundGuideIpbDecision` text "(IDD p 5)" | GSP p 83 para 4 e gives these Indian reserve times: Bn, a committed Coy from the depth localities "within 35-40 minutes of the attack"; Bde, a tank Sqn and about two Coys "within 2-3 hours of the decision of its employment"; Div, an Inf Bde and a tank Regt less a Sqn, 4-6 h of the decision; Corps, an Inf / Mtn Div, an indep Armd Bde, an Inf Bde and an Arty Bde, 12-16 h. IDD p 5 gives Bn about 1 h and Bde 2-4 h after the attack starts. | **Done, side by side.** GSP was added to the IpbDoctrine sources; GSP p 83 refs and text sit beside IDD; OcokaDoctrine `enemyMarch.reserves` now carries the GSP ref; the IpbTemplates reserves row and the tile note in tab 3 name GSP. The ladder the engine reads is still IDD's (Bn 1 h). **Your call:** whether to time own attacks against the earlier Bn figure (35-40 min, GSP and IC). |
| H2 | `IpbTemplates.json` `def-bde`, `def-div`, `def-desert` (src) | Indian frontages on a DCB (pp 82-83): Bn 7-10 km, Bde 24-40 km, Div 80-120 km, Corps 250-300 km. A Mtn Inf Div deploys like ours but on reduced frontages. RAPID(D) on the plains puts its Inf Bdes forward and holds the Mech Bde back as a QRF (R&S Bn elms) and a destruction force. In the desert RAPID(D) holds nodes of 4-8 Coys each, with ATGM, tanks and guns, and mech infantry in the gaps (p 82). | **Done** (src text; the elements are unchanged). The desert node is 4-8 Coys, so `ech` "16" is about right. |
| H3 | `IpbTemplates.json` `phases.offensive` (`breakin`, `breakout`) | p 101: at Corps level he crosses on a broad front, but at Div level his forces are not dispersed. Each assaulting Bn has 13 artillery fire units. The road is opened within 48 h. Break-out is at first light after the assault night. p 121: he assaults across a DCB at two or three points, in one night or at most two. p 99: the strike corps is an Armd Div, a RAPID(S) and 2-3 Mtn / Inf Divs. p 100: in semi-desert it attacks on a corridor 60-70 km wide and 80-100 km deep. | **Done** (src text, beside DW and OOW2). |
| H4 | `PlanDoctrine.json` `ad.vps` src | p 72 para 11 b: HQs, gun areas, reserves and vital bridges get the higher priority. | **Done.** GSP p 72 ref added (verified) and named in `searched`. |
| H5 | `PlanSolve.ts` *Reserve reach* wording | A Div reserve given transport (p 122) is now `mounted`. The row said "on tracks". | **Done.** Armour labels keep "on tracks"; any other mounted reserve says "mounted (transport from the Div's pool, GSP p 122)". |
| H6 | `PlanDoctrine.json` `securityZone` | F1 and F4 hold the 4 km C Tps distance and the 10 km SZ as recipe seeds. | **Open.** Add the paths `securityZone.divCtpsAheadM` (O, Demo2 1-4 km) and `divM` so that the recipes read doctrine instead of seeds. This is a tidy-up, not a behaviour change. |
| H7 | `div-wdr-night.json` / `PlanWithdrawalFmn.ts` | p 145 para 17: "Normally the division commander details a reserve brigade for the preparation and occupation of the [rear main] position". OOW3 pp 39-40 says fresh troops if possible, else a portion of the force, with reserves held at Bde level at least. | **Note only.** The note now names what agrees and the two points that differ. The layout still follows OOW3 (the depth Bde stays the reserve; the new main posn is drawn planned). **Your call:** whether to offer the reserve Bde on the new posn as an option. |
| H8 | same | p 145 para 15: do not set up an intermediate posn if covering troops can do the job, to save infantry. | **Note only** (same note). Two intermediate posns are still always laid; a 0-2 option is open. |
| H9 | `PlanContext.ts` (DCB / obstacle ground, Div) | p 119 para 5: a Div should normally defend no more than two Div-size major approaches unless it is given additional resources. | **Open.** With the terrain read, warn when a Div defence on obstacle ground faces more than two, with the fix "additional resources from Corps". This needs the fit's approach count by size. |
| H10 | `PlanOrbat.ts` / `PlanBuildTab.ts` (Rangers / FC Wings, Mjd Bns) | pp 73-74 paras 13, 17-18 and Annexes E-G: Rangers and FC Wings have no AT weapons (Corps holds 6 x 75 mm RR to sub-allot). They are used only to augment regular infantry in defence, in less threatened sectors, against purely infantry operations. Mjd Bns thicken the less important areas. | **Done.** `PlanOrbat.secondLineRow` adds a "Second-line troops" row in the build and after the fit. A Wing or Mjd Bn (or its rifle Coy / Pl) warns in an attack, crossing or advance. In defence against a Mech / Armd En, a Wing warns unless an AT group is grouped to it, and a Mjd Bn warns. It passes against infantry. Each row cites p 73 / 74. Check my plan does not read the unit type, so it does not run this row. |

## 3. Needs

**N1 Div attack: built 27 Nov 2026.** The Div Attk family has three layouts: *Two up, main Lt*, *Two up, main Rt* and *One up*.

- **Two up.** The main attack (Main Attk arrow) goes onto OBJ A and the secondary attack (2525D Sp Attk arrow) onto OBJ B. Each Bde has its own brigaded FUP, SL and Assy Area, with an inter-Bde boundary between them. The Div reserve Bde stands behind the main attack, with Div Tac forward and Div HQ behind. The LOE is 1 km beyond the objectives (E, as the Bde attack). The 4 km between the Obj centres is a decision (E), so that each Bde strikes a different En Bn locality (IDD p 2: 3-5 km).
- **One up.** The leading Bde takes OBJ A. The follow-up Bde goes round its flank onto OBJ B 3 km in depth (E), and the third Bde is the reserve.
- **New rows** (`PlanDivAttack.ts`):
  - *Div formation*, judged on the ground in `groundNotes`: in mountains two up warns (one up is the more applicable, p 85) and one up gets the mountain rules (pp 174-175); in the desert an Inf Div attack warns (s38 p 171); on the plains one up is told the narrow front is easier to seal off (pp 86-87).
  - *Clear axes*: each Bde on its own axis, and the Div attack frontage (p 86 para 12 d).
  - *Main attack*: the depth behind the main attack (p 90; p 84).
  - *Div reserve*: distance and times, with no limit printed (p 88).
- **Reused checks.** The main attack's FUP, assault frontage, H-hour sum and the other attack checks run as for any attack.
- **Other changes.** The weighed "Form of attack" factor gives a Div layout a neutral value, so it is no longer called a flank attack. The chip labels and the validator were updated.
- **Tests and app.** `idb.mjs` has 18 Div attack checks (49 in all). All 24 planbuilder suites pass. In the app, Attack → Div Attk → Two up, main Lt placed and drew all 19 symbols, and its Check step showed the new rows.
- **Added later on 27 Nov 2026 (user: "why not building now?"):**
  - **Thinking two down** (p 88 para 13 b (3)-(4), (6)). Each Bde's Lt Bn, Rt Bn and Res Bn are drawn; the main Bde's assault Bns use `asltL` / `asltR`, so the attack fit moves them with the FUP. A "Tasks in Bns" row counts them against the Div's 9 (PlanDoctrine `divAttack.bnsInDiv`, GSP pp 9, 60, verified) and warns above 9.
  - **Prelim op chip** (None / Clear outposts, p 89 para 13 d). OBJ P1 / P2 are his outposts on the ground of each FUP, cleared by each leading Bde's Res Bn before the move to the FUPs. A "Prelim op" row checks that each OBJ P lies between the Assy Area and the SL. The force and the time are E.
  - **Phases 1 / 2 chip and the P key** (two up only; one up is phased already, p 88 para 13 b (5)-(6)). Ph 2 sends the Div reserve Bde from FUP C, in the gap between OBJ A and OBJ B, onto OBJ C. OBJ C is his depth, 1.5 km behind and between the two objectives (IDD pp 2-3; the place is E). PL 1 runs beyond the Ph 1 objectives, the LOE moves beyond OBJ C, and the boundary stops short of FUP C. The rows are:
    - *Div phases*;
    - *FUP C from OBJ C* (the night band);
    - *Ph 2 through the gap* (550 m clear of the Ph 1 objectives; wants 300 m);
    - *Fresh reserve*, which **warns**: the book requires a fresh reserve once the reserve is committed (p 88), and the plan names none. It offers three fixes.
  - The Tanks and En Mf chips are hidden on a Div attack, since they are Bn-level.
  - Tests: `idb.mjs` now has 64 checks; all 25 planbuilder suites pass.
  - In the app (on a no-reload server, :6563): Two up, main Lt with Ph 2 and Prelim op placed and drew all 32 symbols.
- **Kept separate, on purpose:** each Bde's full attack plan (each Bn's FUP and axis, BOF, mortars, fire plan, tanks) is still built as a Bde plan. The reasons:
  - The Div commander assesses tasks in Bns and turns them into Bde tasks; the Bde commander plans the Bns (p 88 para 13 b (3)-(4)).
  - Each Bde plan needs its own fit on the ground.
  - A 9-Bn plan with every BOF and FUP would bury the Div picture.

| # | What | Book |
|---|---|---|
| N2 | **Bde on a DCB: built 27 Nov 2026.** `bde-def-dcb` (Bde Def family, `ditch` layout, click on the ditch). Three Bns up as IBB App 9 Bns (2750 x 1850 m) with 450 m gaps (E), 9.15 km held. Mines on the far side and in each gap, two contingency (C Pen) posns behind the gaps, a 2525D Screen 1.5 km ahead (E), Bde HQ and an AT Res in depth, no Bde reserve Bn. `PlanDcb.ts` judges the Depth on the Bns' own and adds five rows: *Three up on the DCB*, *Gaps covered*, *Contingency posns*, *Protective elements* and *Reserves* (the Div's). `idb.mjs` adds 11 checks (75 in all); every suite passes. In the app it appears as Bde Def → *AT ditch* (the `ditch` layout's chip name; the Desert Warfare session added the index line); placed near the border east of Lahore, all its rows passed, with two real warnings from other checks (open flanks to tanks; one Engr Fd Coy needs about 94 h for 9.2 km of mines). | s26 pp 118-121 (paras 5, 6, 8 b-g) |
| N3 | **Relief in line** and **passage of lines** plan types. A Bde Gp needs at least 48 h. Command changes when more than 50 % has been relieved. The guns are relieved last. Armour passes inside one infantry formation's boundaries, through lanes in own minefields marked by the formation in position. | s29 pp 134-140; s20 pp 93-96 |
| N4 | **Mountain Div**: the reserve split to guard the valleys and launch at once; one Bde up in the attack; the approach by night and the attack at first light; reorganisation forward of the ridge line. | pp 122, 174-176 |
| N5 | **Inf Div advance**, with Annex H's figures: covering troops about 1 h or 10-15 miles ahead of the van gd; the leading Pl 20-30 min ahead of the van gd; Bde Gp harbour areas 15-20 miles apart; tanks lead when the ground suits, there are no known AT obstacles and he has armour. An Inf Div advances in open country only if it is made mobile (p 76). | s18 pp 76-80; Annex H p 203 (scan) |
| N6 | **Anti-heliborne**: OPs over likely landing areas, immediate and deliberate action groups, obstacles on landing areas, and bridges prepared for demolition. This could come off the Air tab's En LZs. | s28 pp 127-133 |
| N7 | A desert warning: an Inf Div is least suited to offensive operations in the desert (pp 85, 171), and it can undertake only limited exploitation (p 91). | |

## 4. Where the books differ

- **Indian reserves.** GSP p 83 gives Bn 35-40 min and Bde 2-3 h, both counted from the decision. IDD p 5 gives Bn about 1 h and Bde 2-4 h after the attack. The Corps composition also differs. See H1.
- **Indian DCB frontages.** GSP pp 82-83 gives Bn 7-10 km and Div 80-120 km. IDD p 3 gives Bn 3-5 km on the most likely approach and 7-10 km on the least likely. KYE p 216 gives a Div 20-30 km, wider on a DCB. IC s113 (Foxland) gives a Div 60-80 km on an obstacle.
- **Rail.** GSP Annex J p 204 lists one engine. SO's Hbk 2019 and SD list two, the second for emergency unloading. The Move Planner keeps the Handbook (newer).
- **The rear main posn in a Div withdrawal.** GSP p 145 gives it to the reserve Bde. OOW3 pp 39-40 says fresh troops, else a portion of the force. See H7.
- **Break-out.** His break-out at first light (GSP p 101) agrees with DW p 12. The own break-out comes before first light (OOW2 p 52).

## 5. What already follows the book

- The Bde night assault frontage of 1100-1500 m, wider by day, the desert figure and narrower mountain frontages (pp 86-87): `attack.assaultRowByEch`, `dayFrontage`, `desertNightOfDay`, `mountainFrontage`, and the OcokaDoctrine rows.
- A Bde on a DCB at 8-10 km (p 119): `terrain.kinds.obstacle`, OcokaDoctrine row 18.
- An assault across an obstacle at two places at least (p 90): `div-bridgehead-two-bde` (four crossing places, two bridges) and `bde-cross-two-up` (two places per Bn).
- Three Bdes up on three axes (p 120): `div-def-three-axes`, with the armour in hand as the reserve (p 122).
- The AD VPs (p 72): PlanAD's set.
- The anti-armour plan: an AT reserve, and tanks used to counter-attack rather than as AT guns (pp 155): AT Res slots, `atFramework.tankGunEffM`.
- Withdrawal: covering troops of an Armd Regt group (p 143 para 9 b); intermediate posns that make him deploy and move his guns (pp 144-145); essential timings, i.e. denied until and no rearward move before (p 147, Aprc's Limitations box); leap-frogging at formation level (p 149).
- The En reserves are not used as own figures: the PlanDoctrine `check.reserveMin` note (p 83).
- Canal: defend on the bank, with the higher bank (p 113): the canal recipes. Inundation and the headworks (p 159): `PlanEngr.inundation`.
- Mountain defence on reverse slopes (p 176): the rev-slope recipes.
- Admin: the DAA at 15-20 map squares (Annex J), covered accommodation (p 183) and a separate artillery AP (p 185): AdminDoctrine `gsp` refs.
- Rail (Annex J): 32 / 24 km/h, stock placed 45 min after last light, 90 min between trains, 72 C units, 2,000 t, two AD KFs: all in MoveDoctrine.
- Org (Annex A): a tank Sqn of 14 tanks (44 in the Regt): `tankSqnOf` matches. The rest of Annex A (Btys of 6 guns, a LAT Bn of 36 launchers, 3 S&T Coys of 50 TCVs) was not checked against the ORBAT.
