# Desert Warfare (GSP-1972) vs Intelligent Deployment and Ground Guide

27 Nov 2026. Book: `Material/Literature/1. Books/7. Desert Warfare.pdf` (GSP-1972, 2002; 97 pp; the printed page is the
PDF page; text layer, password 7589). Ref id **DW** (PlanDoctrine / IpbDoctrine / OcokaDoctrine; GunDoctrine `dw`). Read
in full again; digest in memory `desert-warfare-doctrine`. The first full read (24 Nov) is in `Doctrine_Review.md` (R4,
R6, R24-R25, R33-R36, R49-R54, R79-R80, R110, R145-R146, R192, R214-R223); this review checks what the engines do now.

**The copy carries a reader's marks:** 1129 highlights, many with a dictionary gloss as the note ("mounds", "too dry",
"slightly salty, as in river estuaries"), and 7 ink marks. They are a reader's vocabulary notes, not doctrine: never cite them.

The book is guidance up to Div level (p 1) and prints almost no figures: no frontages, gaps, depths or rates of its own.
Most of what it gives the engines are rules, so most fixes below are verdicts the rules change, each cited and checked
by `verify.py` (`PlanDoctrine terrain.kinds.desert.rules`).

## 1. Fixed in this session

| # | Where | Was | Now (book) |
|---|---|---|---|
| F1 | `PlanOrbat.minefieldRow`, `PlanContext.groundNotes` | *Mines in time* passed on the MML time in the desert, the DW p 65 rule only a note. A 12 km front with the Def Engr Bn passed at 18 h by MML though by hand it takes 41 h against the 36 h. | The row carries the hours by hand (`m`) and the hours to be ready (`limitM`). In the desert a time the MMLs alone make good warns: MML only on the dhars, by hand on soft sand (DW s19 para 2 a (2) p 65), with why and fixes. |
| F2 | `PlanAttack.attackBreach` | In the desert the H-hour sum began the lanes on the TAMs' minutes (the Aslt Engr Bn: 54 min a lane). | In the desert the TAMs are not counted: likely to fail on soft sand, the rollers not exploding the mines (DW s19 para 2 b (3) p 65). The lanes are timed by hand (Annex Q), and the row says so. |
| F3 | `PlanArty` *Gun area* (Bn, Div and crossing rows) | Loose sand (bundle class Sand) counted as gun ground for every gun: it is only a caution in the Gun Position going. | For towed guns loose sand is not counted ("in areas of loose sand, it is difficult to move the guns. Therefore, self propelled guns are ideal", DW s17 para 7 a p 60). SP guns take it; the row names the sand share either way. Applies on any ground (loose sand in a river bed too). |
| F4 | `PlanContext.groundNotes` *Reserve reach* | A Bde reserve on foot passed in the desert (Bde Def two up: Depth Bn on foot, 51 min). | In the desert a Bde or Div reserve on foot warns: mechanised reserves are kept down to Bde level, mainly armour (DW s7 para 5 c p 23, para 10 b p 26). The Div and Bde reserves get the note that their counter-penetration mode is less preferred, though not ruled out (para 10 h p 27). A Bn's Coy reserve is not judged by it. |
| F5 | `PlanWithdrawal` *Desert* row | Always a pass, a note. | Judged: the longest walk from a posn to its embussing point. Beyond `withdrawal.desertWalkMaxM` (457 m, the Coy RV, IBB p 381; E: DW prints no distance) it warns. The withdrawing unit cannot be expected to withdraw any distance on foot (DW s9 para 1 p 32). The Bn Wdr by night now warns on its 1.6-2.0 km walks (IBB's 1500-2000 m embussing points, p 383: the books differ). The text adds a clean break, no running fight, an intermediate posn only on a feature with delay potential (p 32), and armour-based covering troops and flank guards (pp 32-33). A delaying action gets the covering-troops note (p 25) instead. |
| F6 | `PlanContext` desert notes | None for the attack, the gaps or the AT cover. | *Form of attack* (desert): armour heavy or combined inf-tank (p 42), direction by the tank going (p 38), objectives comm routes / centres, water, admin installations (p 38), reorganise as carefully as you capture (p 46). *Reserve* (attack): infantry heavy for the break-in, mechanised for the break-out (p 39). *Gaps*: mines cover the gaps; lesser approaches held by mobile / mech task forces (p 23 paras 5 e-f). *AT cover*: the ATGMs concentrated on the most threatened approach, not dissipated (p 58); minefields channel his armour (p 23). |
| F7 | `PlanDoctrine terrain.kinds.desert` refs (R145) | The all-round first layout and the open flanks rested on a ref quoting the reserve time ("within 2 -- 6 hours"). | Rule refs on p 27 (strong points in concentric circles), p 13 (fight the battle outflanked) and p 22 (accepting large gaps). A new `rules` block cites every rule F1-F6 uses; all found on their pages by `verify.py --write`. |
| F8 | `GunDoctrine desert.note` (R146) | "plan successive positions in depth" | Successive gun positions in depth *when a withdrawal is anticipated* (p 60); towed guns and loose sand, trailers (p 60); the dune lee (p 61). |
| F9 | `IpbDoctrine decisionPoints.reserves` | "Reserves committed within 2-6 hours" (DW p 27), with no side named. | Named as the **own** Div and Bde reserves in the desert. The En's are the `indian` ladder (IDD p 5, GSP p 83). No code reads this text; the label stops it being taken for the En's. |

Tests: new `tools/planbuilder-test/dw.mjs` (33 checks). All 26 planbuilder suites pass. `tsc` shows no errors in the
touched files. The four recipe warnings were already there. The ipb suites (13), sitefinder run / tools and aprc (354)
pass too. `verify.py --write` found every new DW ref on its printed page.

## 2. Needs: built in the second and third rounds (27-28 Nov 2026, the user's "start" and "build them")

**Intelligent Deployment**

| # | Status | What was built (book) |
|---|---|---|
| N1 | **Done** (28 Nov) | *Sited to deny* on every desert defence of a Bn and up: the main defences deny comm centres, tactically significant BUAs and admin areas and the ground dominating the MSRs (DW s7 para 5 a p 22); desert tracts in themselves are insignificant (p 7). Grey from `groundNotes`, then measured in the fit (`PlanFit.desertSitingRow`): an MSR (the road network's MSR flag, read through the probe's roads) or a motorway / trunk / primary / secondary road within 2 km of a posn, or a city / district HQ / town / important village within 1 km (`terrain.kinds.desert.siting`, E). Unclassified tracks flagged all-weather and small villages do not count (most desert tracks are fair weather, DW p 2). On the real bundle: Mithi town, Kinra and the Border Road pass; an open Cholistan spot warns. |
| N2 | **Done** | New recipe `bde-def-mobile` (family *Armd Bde Mobile Def*, layout `mobile`, the IABG) on MIB Annex P paras 2, 6 pp 357-358: an MIB Gp and an Armd Regt Gp fix (check left and right, force him into the centre, contain him from each flank), an Armd Regt Gp in depth is the deliberate counter-attack force, the Bde's minefield on the left. Rows (`PlanBua.mobileRows`, through `PlanMountain.layoutRows`): *Killing zone* between the fixing groups; *Counter-attack force* mounted, behind it, timed against the Bde reserve's 2 h (DW p 27); *Fixing and striking* (the books differ: in DW p 22 the bulk attacks, in Annex P one group of three). In the desert the row adds: mobile defence preferred in the Thar, combined in Cholistan (p 22 para 4 c). Sizes are E (Annex P draws only the Bn's area); its *Depth* (8 km) and *Mutual support* (the KZ gap) rows warn by design. |
| N3 | **Done** (every plan) | `PlanFit.atgmExtras`: every approach in ATGM reach first, then all the remaining pairs on the main approach (was: the rest sent to the open flanks, spread evenly). An LAT Coy's 7 pairs now go 6 on the main approach and 1 on the secondary. *AT cover* warns when another approach has more ATGM in reach than the main (DW s16 para 4 b-c p 58; IBB p 73). |
| N4 | **Done** | *Strong points* row on a desert Coy / Bn defence: concentric circles, inner core, mines, depth, pivots, administratively self-sufficient and stocked to fight when bypassed; prepared to fight outflanked (pp 13, 27-28, 85). A note. |
| N5 | **Done** | *Covering troops* row on a desert Bde / Div defence: occupied by night, armour based, long-range engagement, deflect or canalise into a killing ground, a handover line (pp 24-25, 56). A note. |
| N6 | **Done** (28 Nov) | *Dune lee* row with the artillery on the ground (`PlanArty.duneLeeRow`): from each DF Tgt back toward the nearest gun area, every 30 m out to 300 m, a sand or dune crest rising 15 m (50 ft, the lowest dunes, DW p 2) or more at an angle above 20° (the shell's fall, E) hides the target: warns with the targets named and the fixes (mortars / air, the line of fire along the dunes, air burst). No row where no sand stands round the targets; grey without elevation. Figures in GunDoctrine `desert.duneLee`, kept equal to the code by `dw.mjs`. Checked on synthetic dunes only, not yet on a real Thar plan with guns. |
| N7 | **Done** (28 Nov) | New recipe `bn-attk-infiltration` (family *Bn Attk (Infil)*, layout `infiltration`) on IBB S45 pp 221-230 and DW p 48: the assembly area close to the infiltration points, two lanes through the En FDL (hostile), the gap shoulders held, an RV and a firm base near the Obj beyond the En FDL, the FUP and the assault as a normal attack. Rows (`PlanInfil.infilRows`, through `layoutRows`): *Lanes* (two for a Bn, IBB p 225; several routes, DW p 48), *Through the En FDL*, *Gap shoulders* (IBB p 228), *RV and firm base* (DW p 48 a; IBB p 227), *Link-up* (24-36 h, IBB p 223; seize and hold, DW p 48 d), *Fire support* (Div artillery, IBB p 222; medium guns, DW p 48 c). Distances E (`PlanDoctrine infiltration`). `solve.mjs` now checks a slot marked hostile carries the hostile identity. |
| N8 | **Done** | *Desert* row on patrols, ambushes and recce in the desert (`PlanSmallOps.desertMinorOpRow`): hideouts, by night, FOO / FAC, wheels where far. When the patrol already runs past the night on foot it warns, offering wheels, helicopters or a hide on the way (pp 28-30). |
| N9 | **Done** | *Desert* row on the advance (`PlanAdvance.desertAdvanceRow`): an Armd Bde on one axis warns (a very wide front on combat groups, multiple axes, pp 35, 55; fix: two Regt groups on two axes); a Bn and the Div's two axes carry the rules as a note. |
| N10 | **Done** | *Desert prep* row on a desert Coy / Bn defence: frame revetment 6 h a weapon crew + 4-6 h for the frames, 114,994 sandbags for a Bn on a forward slope, double for forward and reverse, revetting stores on 1 / 5 x 2½-ton (Annexes A-B pp 93-97). A note. |
| N11 | **Done** (28 Nov) | The Admin Area finder on desert ground (`SiteScan.desertGround`, the Plan Builder's Auto desert test; AdminDoctrine `desert`, source `dw`): *Forward (desert)* warns an area behind its operation's figure (as far forward as possible within easy turn-round, DW s24 paras 7 h, 8 a p 82); the *Water* row for every kind (sweet water only in tobas and the green belt, p 80; water points round the clock, p 86); the desert note (mobile APs to the forward Bdes, petrol points well forward, supply points within first-line turn-round, moves avoided, the stores lift; AD after reserves and HQs, p 63). The Plan Builder's ground may set it (`task.desert`). `tools/sitefinder-test/admindes.mjs` 11 checks. |

The ground kind for the advance and the small ops is the one set in the tab, else read where the plan rests (`PlanFit.detectTerrain`).

**Ground Guide**

| # | Status | What was built (book) |
|---|---|---|
| G1 | **Done** | `GroundGuideOcokaRead.desertSight`: where half the ground read is bare desert, sand, dunes or salt pan, the Extended View reading carries `desert` (OcokaDoctrine observation.desert). A *Desert* line in the Weather & Light tile and in Copy as Text: movement seen 5-20 km from a vantage point by the view, dunes block ground OPs, better by night (DW pp 7, 61). |
| G2 | **Done** | The water points round the point (the card's water kinds plus wells, pumps, tanks) go into the reading. On desert ground a key-ground candidate within 1 km of one ranks higher, "Commands water" (DW pp 7, 38), and the ranking note says how many were read. Off the desert water weighs nothing. |
| G3 | **Done** | `GroundGuideAor`: in a desert AOR (country group 2 over 30 %) a water line across two approaches stands as a line of def by itself, the villages being few. Each such line says why (canals in the green belt / villages in the desert belt, DW p 4) on the D sheet and in Copy as Text. Off the desert the rule is unchanged (two BUAs). **Checked in the app on 28 Nov** (Bde AOR, `aorAround`): Fort Abbas and Marot get canal lines (2 L Minor, 9 R Disty, Hakra Branch) and village lines; the deep Thar (Mithi, Chachro, Diplo) got none, its villages too small and scattered for the 300-people / 800 m test, so in a desert AOR a village now counts from 100 people within 2 km (`VIL`, E: DW p 7 long ranges) and those AORs get W, X, Y village lines. The check also found Islamkot (72 m of relief) reading Mountains: fixed by the Aprc session in `aorCountry` (slope classes are Mountains only at a 400 m rise in 5 km). |

Tests: `tools/planbuilder-test/dw.mjs` 72 checks; `tools/ipb-test/desert.mjs` 18 (with the Aprc session's G4; it reruns itself with `--experimental-transform-types`: the Ground Guide view modules carry TypeScript parameter properties); `tools/sitefinder-test/admindes.mjs` 11. New refs in `PlanDoctrine` (terrain.kinds.desert.rules, .siting, infiltration), `GunDoctrine desert.duneLee` and `AdminDoctrine desert` found on their pages by `verify.py --write`. All planbuilder, ipb, sitefinder and aprc suites pass; tsc clean on the touched files.

## 3. Where the books differ

- **Embussing points.** IBB s75 para 20 a p 383 puts Coy embussing points 1500-2000 m back (the *Embussing points* row still passes on it). DW p 32 says no withdrawal on foot for any distance in the desert (the *Desert* row warns). Both rows stand.
- **The intermediate posn.** IBB / OOW3 lay an intermediate posn that makes him redeploy. DW p 32 says a clean break to the next main posn, no running fight. The *Desert* row says an intermediate posn only on a feature with delay potential.
- **C Pen at formation level.** IBB / GSP plan C Pen posns at Bde and Div (GSP pp 108-109). DW p 27 h makes the tactical reserves' counter-penetration mode less preferred in the desert. The posns stay; the note says so.
- **Reserve times.** DW p 27 (own Div / Bde reserves within 2-6 h) is not the En's. The En ladder is IDD p 5 with GSP p 83 beside it.
- **Desert attack frontage.** DW p 47 (by night half the day's) meets GSP p 87 (a Bde in the desert up to 3000-4000 m) at its lower end (recorded 24 Nov).

## 4. What already follows the book

- Extended frontages and large gaps accepted (pp 22, 24, 56): `extendedFrontage`, `gapsAccepted`, `bnFrontageCheck`, `frontageRowCheck` (a Bde / Div beyond its row warns, never fails).
- Reserves one third or more, measured on Bde and Div plans (p 26); employed within 2-6 h, the check at 2 h (p 27): *Reserve share*, `check.reserveMin`.
- The night attack at half the day frontage, more in bright moonlight (p 47): `assaultFrontageCheck`, `desertNightOfDay`. Tanks under the attacking infantry's command at night (p 48): note.
- AD priority in the desert: reserves, HQs, gun areas (p 63), crossing sites highest in a break-in (p 64): `ad.vps.desert`, `PlanAD.vpOf`.
- The En in the desert is armour led (pp 10-12): `enemyType: armd`.
- Open flanks (p 13): the fit's *Flanks* row warns in the desert. The all-round layout first (p 27).
- The Div advance on a broad front, two Bdes (pp 35, 55): `div-advance-two-bde`.
- An Inf Div attack in the desert warns (GSP p 171; DW p 42 agrees: armour heavy or combined).
- Desert foot rates (IBB p 18, 3 / 2.5 km/h) for the reserve and the what-if.
- Ground Guide: dunes give ground cover 2 (safety first) and none from air (p 8); dunes caution for tanks (p 54); sand a caution for guns (p 60); the Rann NO-GO June-November (p 4); dhars as LZs (p 66, `firmFlat`); the `def-desert` nodal-point template and `strike-bh` with two lodgements of 2-3 Bdes (pp 11, 14-18); the AD priority cite (pp 63-64); the desert frontage rows.
