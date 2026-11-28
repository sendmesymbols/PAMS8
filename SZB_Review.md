# Concept and Conduct of SZ Battle vs Ground Guide, Aprc and Intelligent Deployment

28 Nov 2026. Book: `Material/Literature/1. Books/10. Concept and Conduct of Security Zone Battle.pdf`, a C&SC Quetta handout
(2010, RESTD, 27 pp). The password is 7589. It has a real text layer, and the printed page is the PDF page. Figs 1-4 (pp 9,
15, 16, 22) are drawings. They were rendered and read, and they add nothing beyond the text. The yellow and blue
highlights are a reader's, not the book's. Suggested ref id: **SZB** in PlanDoctrine / IpbDoctrine (upper case).
GunDoctrine already holds this book as `sz`. Digest in memory `szb-security-zone-doctrine`.

It is a handout, not a GSP pamphlet. Where it differs from OOW1, GSP, MIB or DW, keep both side by side (§5). It is the
only book in the library with covering troops (C Tps) figures at Cbt Gp / BG / CAT level, and with the En's force for
clearing the SZ.

Already cited before this review:

- GunDoctrine `sz`: p 24 para 38 c ("2/3RD range should be kept towards own area"). It has 3 refs, all checked by verify.py.
- PlanDoctrine `securityZone.bdeM`: its E note quotes p 3 (2-5 km in the Punjab, 20-50 km in the desert) as text only.
  It has no ref, and SZB is not a PlanDoctrine source.
- AdminDoctrine: "SZ Battle" is named in the `searched` lists only.

**Built 28 Nov 2026** (user: "Build in order"), every item below. What was built and the decisions taken are in §0.

## 0. Built (28 Nov 2026)

- **Sources and refs (U1-U4).** SZB is a source in PlanDoctrine and IpbDoctrine. All 23 SZB refs were found on their
  printed pages by `verify.py --write`.
- **I1 / E4: the SZ by ground** (`PlanSz.ts`). It reads `securityZone.byGround`: plains / obstacle 2-5 km, desert 20-50
  km, mountains 0 (D, p 3).
  - When the IB is not read, the SZ is drawn at `drawnDepthM` (M): 5 km on plains, 20 km in the desert.
  - When the Ground Guide's borders are loaded, the SZ runs to the IB. This comes through a new host hook,
    `borders()` (DeploymentHost → BuildTabHost), and `guide.borderLinesMerc()`.
  - In the desert three DLs (`securityZone.dls`, E, Fig 2) and a BHOL 2.5 km ahead (`bholAheadM`, E) are laid, with
    the C Tps on DL 1. Mountains lay no SZ and no C Tps.
  - New rows: *Security zone* (grey while the IB is unread) and *Delaying lines*.
  - With no ground given, the old 10 km / 4 km drawing is unchanged. In the app, a Div Def facing east from Islamkot read
    the IB 75 km ahead, and the SZ and DLs ran to it.
- **I2 / I3 / I5 / U7 (Aprc).**
  - The protective dets are drafted by the SZ's ground. Plains under 5 km get screens and an adv posn. The desert gets
    C Tps on the lines ahead as DLs. The mountains get no SZ battle: OPs, screens and link ptls, and no delay lines in
    the Vis.
  - `SZ_TEXT` sits beside UA's figures.
  - The Vis carries SZB p 19 (the shallow / deep mnvr). In a desert SZ over 10 km it also carries pp 7-8 beside DW and
    the 1 km/h.
- **I6 / I7 / I8.** SZB's ambush ranges and techniques now sit beside DW in the desert rows. The sketch reads "BHL
  (BHOL)". The MIB cite is corrected to para 5 a pp 232-233.
- **U5 / U6 / U8 / U9 (Aprc prompts, templates, anti-HB).**
  - Aprc prompts: arty, AD and engrs in the SZ; 2-2.5 second-line lifts; the En's SZ clearance, the feint and
    para / HB up to a Bde.
  - The IpbTemplates phase and strike-bh texts carry SZB beside DW.
  - The anti-HB *Deliberate action* row gives the scale (up to a Bde at a time).
- **U10.** The Aprc Limitations box has two new controls, *Inflicting cas (%)* and *While remaining a viable force*.
  The aim reads e.g. "Delay the En for 48 hrs inflicting 30% cas on the En, while remaining a viable force."
- **E1.** The Bn delay has a new *Technique* chip, Successive (default) or Alternate (`PlanDelay.withDelayTechnique`,
  id `bn-delay-alt`: Gp 1 = A, B Coys on DP 1, Gp 2 = C, D Coys on DP 2). Its rows are *Technique* and *Handover*.
  Check my plan reads `-alt` back.
- **E2: killing grounds at dhars** (`GroundGuideDhar.ts`). A dhar is a flat-class core with dunes rising 10 m within
  1.5 km on 3 of 8 bearings (IpbDoctrine `killingAreas.dhar`, E).
  - In the desert the Fire engine ranks killing area candidates at a dhar first and adds dhars under fire.
  - The Aprc's Killing Areas para says so.
  - The Plan Builder's desert killing ground goes to a dhar's middle; row *KG at a dhar*.
- **E3: the SZ in the AOR reading** (`aorSz`). It reads the depth and sector, and the DLs in the desert. It shows on the
  rail's lines row, the D sheet row *Security zone* and Copy as Text. When the IB lies outside the AOR, it says only
  that the SZ is deeper and does not judge the band.
- **N1: the C Tps battle plan** (`PlanCtps.ts`, PlanDoctrine `securityZone.ctps`).
  - Families: *C Tps Battle (BG)*, which takes options 1-3 (`bg-ctps-two-up`, `-three-up`, `-narrow`; Armr Regt), and
    *C Tps Battle (Cbt Gp)*, which takes options 1-3 (`cbtgp-ctps-opt1`..`3`; IABG).
  - Rows: Frontage, CAT frontage, Option, Mask posn, Killing ground, Behind mines, Delaying lines, Delay (the DLs × 3-6 h
    against the delay ordered, from the new Delay chips), Fall-back routes, BHOL and passage (E5), and Arty, AD and
    engrs and Night and security to confirm.
  - The Bn main-defence rows that do not apply are dropped: Bn frontage, depth, MG mutual support, approach
    responsibility and a continuous minefield in time (`ctpsOverride`).
- **E7.** A new template, `sz-desert`: the Flight Path Bde, the Direct Pressure Force, two Encircling Forces and an
  Interception Force. A Div HQ in the desert reads it. The Fig 1 reading is recorded in `confirmations.szbFig1` as not
  confirmed.
- **Tests.** The new file `tools/planbuilder-test/szb.mjs` has 79 checks. Checks were added to aprc-test (400 in all)
  and ipb fire.mjs (25). recipes.mjs accepts a CAT's 4-8 x 2 km posn. All suites pass except the known OCOKA "crop mix"
  check. `tsc` is clean on the touched files.
- **Checked in the app (:6547).**
  - The C Tps BG plan builds with only its grey rows, and 48 h ordered warns (9-18 h).
  - A Div Def on desert ground lays DL 1-3 and the BHOL.
  - The live AOR reading at Mithi and Kasur carries `sz`.
  - The Aprc aim reads the C Tps msn.

The sections below are the review as written before the build; §0 says what each item became.

## 1. Inconsistencies (an engine contradicts the book, or two engines disagree)

| # | Where | What the engine does | What the book says | Proposed fix |
|---|---|---|---|---|
| I1 | `Recipes/div-def-two-up.json`, `div-def-three-axes.json`; PlanDoctrine `securityZone.divDepthM` (10 km, O), `divCtpsAheadM` (4 km, O), both from the Demo2 sample | Every Div defence draws a 10 km SZ with one C Tps group 4 km ahead of the FDL, whatever the ground. | p 3 para 5: the SZ depth depends on the sector. Kashmir and the north have an exaggerated forward posture and **no SZ battle**. The Punjab plains have **none, or 2-5 km**. The desert and semi-desert, to the coast, have **20-50 km** (the classical SZ). p 3 para 7: the SZ is the area **between the IB and the main def posn**. p 10 para 20 b: C Tps fight on **a series of DLs**. | Make the SZ depth follow the plan's ground kind: add `terrain.kinds.*.szDepthM` (plains [2000, 5000], desert [20000, 50000], D, p 3). Mountains already lay none (PlanMountain row *Security zone*, MW p 164). Where the Ground Guide holds the bundle's borders (`boundaries.geojson`), end the SZ at the IB, passed in through a host hook like `threat`. Add a row *Security zone* that judges the space. In the desert, lay the C Tps on DLs (N1, E4). Keep Demo2's 10-19 km as an O sample beside it, not as the rule. |
| I2 | `AprcMechs.layoutDef` / `gr.ded.dp1.adv` | On every ground the draft cites UA's "Recce elms 25-100 km out, covering tps 15-25 km, an adv posn 5-10 km". In the plains, with the FDLs 5-8 km past the border, C Tps 15-25 km out would stand beyond the IB. In the desert, the C Tps are put "1.5-2 km past the border", although they should fight across a 20-50 km SZ. | p 3 para 5-6: in the Punjab it is hard to fight on several DLs or organise KGs, so there is little or no room. The desert allows the classic use of mech forces. | Draft the protective dets from the SZ depth the AOR gives (`fdlKm`) and the ground. Below the book's Punjab band: screens and an adv posn only, saying why (p 3). Desert: C Tps on DLs across the SZ (p 10 para 20 b; p 11-12 para 22). Mountains: see I3. Keep UA's figures as the guide's, beside the book's. |
| I3 | `AprcMechs.layoutDef` and `visDef` (mountains) vs `PlanMountain` | In mountains the Aprc still drafts protective dets on the lines ahead, and the Vis gives each line a 4-6 h delay. The Plan Builder says no SZ exists along the LoC. | p 3 para 5: no SZ battle in Kashmir and the north. MW s12 p 164 agrees. OOW1 pp 73-75: on glaciated ground the SZ may be held by observation only. | In mountains, draft OPs, screens and link patrols only, with no delay lines in the Vis. Cite p 3 beside MW p 164. Then the two engines agree. |
| I4 | `IpbTemplates.json` `phases.offensive.sz` | "Cleared by an armd div on multiple axes in 24-48 h, with DPF, encircling and interception forces" (DW pp 10-12) is the only reading. | pp 7-8 para 15: the En clears the SZ **by daylight** with a **Flight Path Bde** (an Inf Bde, which clears the BOPs on a wide front), then an **Armd / Mech Bde ex RAPID(D)** on a broad front (20-25 km). p 3 para 6: in the Punjab the **holding formation** clears it; in the desert, strike corps elements do. | Put SZB beside DW (§5). In the plains template, name the holding formation as the SZ clearer. |
| I5 | `AprcMechs.visDef` | The SZ is cleared at 1 km/h (UA) at every depth. A desert SZ of 20-50 km then takes 20-50 h. | p 7 para 15: the En means to clear it in daylight hours. DW pp 10-12: an Armd Div takes 24-48 h. | Keep the guide's model. Where the AOR is desert and the SZ is deeper than about 10 km, show the books' figures beside it (books differ, §5). Nothing is replaced. |
| I6 | `PlanContext.desertDefenceRows` *Covering troops*; `PlanWithdrawal` *Desert* row | Both say "engage at long range" (DW). | p 12 para 22 b: the delaying posn **ambushes at 1200-1500 m**. p 26 para 41 d: **800-1200 m**, "as against engaging at long ranges". The handout differs with itself and with DW. | Add both SZB figures to the rows' text beside DW. Judge no figure (§5). |
| I7 | `AprcMechs` ANX P sketch list | "BHL". | p 5 para 9 h: **BHOL**. The catalog symbol is *Battle Handover Line (BHOL)* `25141902`. | Change the wording to BHOL (a nit; the regex already matches "battle handover"). |
| I8 | PlanDoctrine `withdrawal.delay` src, `bn-delay.json` note | Both cite "MIB s28 para 6 a p 233" for the delay on successive posns. | Found while checking E1: in MIB the successive method is **para 5 a** (pp 232-233), the alternative method para 5 b (p 233), and para 6 is the factors (pp 233-234; 6 a is *Forces available*). The quote and page are right; only the para number is wrong. | Correct the para to 5 a. |

## 2. Updates (refs and figures into rows that exist)

| # | Where | What to add (book) |
|---|---|---|
| U1 | PlanDoctrine and IpbDoctrine `sources` | Add SZB with its file. Then the quotes below can be checked by `verify.py --write`. |
| U2 | PlanMountain *Security zone* | p 3 para 5 beside MW s12 p 164. |
| U3 | PlanContext *Covering troops* (desert), PlanWithdrawal *Desert* | p 11 para 22 a: the C force in depth on the expected thrust lines, **"line pattern rather than linear"**. p 11 para 22: attraction (lure into KGs) or deflection (no pen, deflect into KGs and M fds). pp 14-16 para 27: successive DLs when the sector is wide and the force too small for more than one line; alternate DLs when the sector is narrow or the force reinforced. |
| U4 | PlanDoctrine `securityZone.bdeM` | A ref for p 3 (context). Add p 11 para 20 d: C Tps are provided by Div or Corps, and by a Bde only when it operates independently. This agrees with OOW1 p 13. |
| U5 | GunDoctrine / PlanArty / Aprc Adm & Log | p 24 para 38 d: gun frontages wider near the forward DL and compact near the BHOL. p 25 para 38 f: **2-2.5 second-line lifts** of ammo for the SZ battle, dumped on gun posns along each DL. p 24 para 38 a (2): SP med / hy for close sp, long-range towed med for depth. |
| U6 | IpbTemplates offensive (desert); Aprc contingencies; `bn-anti-hb` | p 7 para 12: two efforts **40-90 km** wide. p 7 para 13: a feint by the Holding Corps **50-60 km** away. p 7 para 14: para / heliborne forces **up to a Bde at a time** into the intermediate depth, to take ITG or hold up the reserves. For the anti-HB plan this gives the scale, beside GSP s28. |
| U7 | IPB decision tab; Aprc reactions table | p 8 para 15 a: the En's lean-on unit enters the M fd **15-20 min before H**. p 19 para 31: the En's **shallow mnvr is 10-15 km deep in 3 h**, a **deep mnvr by a second Cbt Gp 20-25 km in 6 h**, failing which he resorts to penetration ("Corridor Bursting"). These agree in order with UA's "a delay line holds 4 h (6 along an obs)", so show SZB as the why. |
| U8 | PlanAD (in a SZ only) | p 25 para 39: AD tasks in the SZ, in this order: the mech elements on the DLs (most preferred), the fall back of the CATs, gun posns, HQ. This differs from GSP p 72's priority for the main defence. Use it only for C Tps. |
| U9 | PlanEngr; Aprc engr prompts | p 25 para 40: mines on the major thrust lines along the DLs, to cover gaps and lure the En into KGs; anti-trawl / tank ditches if there is time; tank posns; stay-behind parties' posns; water; laterals for shifting resources. |
| U10 | Aprc Limitations box | p 4 para 8, p 26 para 41 f-g: a C Tps mission is a delay for a time, and / or a % of cas (20 %, 30 %), "while remaining a viable force" (e.g. "delay the en for 48 hrs inflicting 30% cas"). Add *delay __ h*, *inflict __ % cas* and *remain viable* for a delay / C Tps task. |

## 3. Extensions to existing features

| # | Where | What |
|---|---|---|
| E1 | `bn-delay` / `PlanDelay.delayGeom` | Add a *Technique* chip: **Successive** (default, as now) or **Alternate**. MIB s28 para 5 b p 233 gives alternate posns as the second method, and para 6 pp 233-234 the factors for choosing. It needs enough force for two posns at once, and it suits a narrow sector or a reinforced force. One suitable posn, or a big En edge in combat power, means successive. SZB pp 14-16 agrees, with Fig 3. Alternate splits the Bn into two groups: one holds DP 1, the other prepares DP 2, and they leap-frog. Rows: *Technique* (why this one), *Handover at each DP*. Disadvantages / advantages list p 15 para 27 a (5), p 16 para 27 b (6). |
| E2 | `GroundGuideIpbFire` killing areas; `PlanFit` killing ground (desert) | In the desert, rank killing area candidates at **dhars**: open flat ground ringed by dominating dunes (p 13 para 25 c). The Air tab already tests firm desert flats for LZs (DW p 66, `GroundGuideIpbAir`), and the sections read dune lines (`DuneField`). Combine them: a flat class patch with dune faces round it. In dense country KGs are hard to find (p 13 para 25 d), so say so instead of forcing one. |
| E3 | `GroundGuideAor` reading → Gr Scope AOR row, D sheet, Aprc para 6 | Name the **SZ** (IB to FDLs) with its depth, and say what the book allows on this ground: none in mountains, 2-5 km in the plains, 20-50 km in the desert (p 3). Where it is deep enough, the lines ahead of the FDLs take a role **DL**. The AOR already measures each line's distance past the border, and the role list (`AorRole`) only lacks DL. |
| E4 | Div defences (desert) | Following I1: lay two or three DLs across each forward Bde's axis, with a KG ahead of / astride each, a BHOL forward of the FDL, and the passage gaps of Fig 4. This replaces the single C Tps point. |
| E5 | Div / Bde defences, withdrawal | Add the rearward passage of the C Tps through the main defences (p 21-22 para 35, Fig 4): junction point, passage points, lanes marked with guides, bounds to the BHOL under the holding formation's screens, column with guns toward the En, RV, conc area. p 22 says handover at the BHOL is often impossible in the desert (the C Tps keep supporting), and desirable behind a major obstacle or DCB. The OOW3 withdrawal already lays lanes and contact points (`PlanWithdrawal`), so reuse that. |
| E6 | Aprc def outline, DP 1 (desert SZ) | Prompts from the book: the C Tps mission (delay- or attrition-oriented, p 6 para 11), the technique (p 14 para 27), DLs, KGs, BHOL and passage, and grouping as Cbt Gp / BG / CAT (p 12-13 para 23). The draft already lists "the screens' and protective dets' composn" as missing; para 23 fills it. |
| E7 | Ground Guide situation templates | Add an **En SZ-clearing template** for the desert, when own C Tps or a SZ are on the map (pp 7-8 para 15, Fig 1): a Flight Path Bde on the BOPs, then the Armd / Mech Bde as a Direct Pressure Force (1-2 Cbt Gps with armr Sqns on 20-25 km, 1-2 Sqns leaning on the flank), two Encircling Forces (Cbt Gps) round the flanks, and an Interception Force with AHs. Set Fig 1 to `confirmed: false`, as Figs 6 / 7 are. |

## 4. New feature

**N1. A Covering Troops / SZ battle plan in Intelligent Deployment.** The engines have Bn delays (MIB) and formation
withdrawals (OOW3), but no C Tps battle. The handout gives enough to build one:

- **Recipes**: BG option 1, two CATs up one in depth ("preferable", p 17 para 28 b (1)); option 2, three up on a wide sector;
  option 3, a narrow sector with two CATs on successive lines and one in reserve. Cbt Gp options 1-3 (p 16-17 para 28 a):
  the heavy BG on the main armr apch, the second on the secondary, the third in reserve; one strong BG on all DLs; a HAT gp
  on DL 1 with the tank-heavy gp behind (its soft vehicles warned against arty and air).
- **Placing**: click the BHOL (or the FDL) and aim at the IB. DLs are laid across the En axes in the SZ, successive or
  alternate (Figs 2-3).
- **Frontages** (p 13 para 24, p 17 para 28 c): Cbt Gp 60-70 km, BG 20-25 km, CAT 8-10 km (6-8 km within a DL). A tk tp or
  HAT pl holds 1200-1500 m, with 600-700 m between tanks / weapons and 500-1000 m between tps / pls. One tk tp sits in a
  **mask posn** ahead of DL 1.
- **Ground**: a KG ahead of or astride each DL (at a dhar in the desert, E2). Battle posns behind a M fd, on a ridge,
  dominating with clear fields of fire, flank observation, depth, fall-back routes, and covered access to the KG's flanks
  (p 14 para 26). Fall-back routes are judged for cover, concealment, a direct line to the next posn, good going and M fd
  gaps (p 20-21 para 32 l).
- **Rows**: SZ depth by ground; Technique; Frontages; KGs; Battle posns; Mask posn; Fall-back routes; En outflank (shallow
  3 h / deep 6 h against the time each DL is to hold, p 19); Delay achieved against the delay ordered; Arty (2/3 range,
  wider forward and compact near the BHOL, lifts); AD (mech elements on the DLs first); Engrs (mines on the thrust lines);
  Night (CAT frontages reduced, gaps by surveillance, p 21 para 33); Passage at the BHOL; Security (screens at CAT level, a
  Div flank force, p 23 para 36).
- **Symbols**: everything is in the catalog already: Covering Tps `25342201`, Delay `25342400`, BHOL `25141902`, Battle Posn
  `25151200`, Engagement Area `25151300` / Killing Gr `25242300`, Screen `25342203`, Fixation `25341100`, Security Zone
  `00000161`.
- **ORBAT**: the units come from the ORBAT (Armr Regt, MIB, HAT Bn) through `PlanOrbat`.

The handout gives no C Tps appreciation specimen. So I would not add a fourth Aprc kind; E6 puts its heads into the
defence's DP 1 instead.

## 5. Books differ (keep side by side, judge none)

| Topic | SZB | Other books / engine |
|---|---|---|
| SZ depth | none (Kashmir), 2-5 km (Punjab), 20-50 km (desert), p 3 | Amplification of Military Terms p 3.7: 1-3 / 5-6 / over 10 km by terrain. Demo2 sample: IB to FDL 10-19 km (O). UA: protective dets out to 25-100 km. |
| Who clears the SZ, how fast | Flight Path Bde + Armd / Mech Bde ex RAPID(D), by daylight, 20-25 km wide (pp 7-8); holding fmn in the Punjab (p 3) | DW pp 10-12: an Armd Div, 24-48 h. UA: 1 km/h. |
| Engagement range of the delaying posn | 1200-1500 m (p 12 para 22 b); 800-1200 m (p 26 para 41 d) | DW pp 24-25: at long range. |
| CAT frontage | 8-10 km (p 13 para 24) | 6-8 km within a DL (p 17 para 28 c (1)), the same handout. |
| AD priority | in the SZ: mech elements on the DLs first (p 25) | GSP p 72: HQs, gun areas, reserves, vital bridges (main defence). |
| Delay methods | successive / alternate, when each (pp 14-16) | MIB pp 233-234: the same two methods. **Agree.** |
| Delay per line | En shallow mnvr 3 h, deep 6 h (p 19) | UA: a delay line holds 4 h, 6 along an obstacle. **Agree in order.** |

## 6. Not taken

- Para 16 (def as the stronger form) and para 42 (conclusion) are principles with no rule to test.
- Para 41 g on viability (a force at 10 % may be viable, one at 70-80 % may not) is a judgement. It becomes the
  *remain viable* limitation in U10 and nothing more.
- Para 37, C2 (relay jeeps, LOs, COs in jeeps / APCs), would only add prompts.
- "Corridor Bursting Drill" (p 19 para 31 c) is named only; the book does not describe it.

## Suggested order

1. I1-I3, which give wrong results on desert, plains and mountain ground, with U1-U4 (sources and refs) and the small
   fixes I6-I8.
2. U5-U10 (text and figures into rows that exist).
3. E1 (the delay technique chip), E2 (dhar KGs), E3 (the SZ in the AOR reading).
4. N1 (the C Tps plan), which brings E4-E5 with it, then E6-E7.
