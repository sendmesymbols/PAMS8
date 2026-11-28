# Aprc review: the five books against GroundAppreciation (28 Nov 2026)

The user asked for `MS/Engines/GroundAppreciation/` to be checked against the books read most recently: GSP-1947
*Infantry Division in Battle* (cited **GSP-1947**), *Infantry Battalion in Battle* (IBB, attack and defence), *Operations of
War* Vol I (defence) and Vol II (offensive), *Mountain Warfare* (MW) and *Desert Warfare* (DW). Each page below was checked
in the PDF before it was cited (printed pages; MW's drift table in the memory digest). The earlier reviews hold the other
books: `Doctrine_Review.md` (R65-R93 are the Aprc's), `IDB_Review.md`, `MW_Review.md`, `DW_Review.md`, `IC_Review.md`.

Before this round the Aprc had none of GSP-1947, and its mountain and desert rules were limited to the 24 Nov list
(R79-R88). It applied the guide's Bn figures to every echelon and the plains' figures to every ground.

## 1. Fixes (the module said something the books contradict)

| # | Where | Was | Book | Now |
| --- | --- | --- | --- | --- |
| F1 | `AprcMechs.coysUp` | Used IBB Annex U App 6 (4,500 m two up, 6,500 m three up) as the normal frontage; "extended" only past 6,500 m. | Annex U is the **extended frontages** annex. A Bn normally holds 3,000-5,000 m in the plains, up to 2,000-3,000 m deep (IBB S53 para 4 c pp 276-277). Along a canal or A tk ditch of 24 m or more (IBB S60 p 331), three Coys up to 4,115 m (IBB S61 p 333; Annex V p 483). Below Bn no frontage is extended (IBB S59 para 6 b p 326). | Extended past 5,000 m (past 4,115 m along such an obs, three Coys up); App 6 named as the extended layouts. Mountains and desert print no Bn figure: IBB's taken, the book's rule beside (OoW Vol I p 72; DW p 22, GSP-1947 p 172). |
| F2 | `writeLayoutDef` Res | "Armr, Engrs and two thirds of the depth Coy; LAT and HAT never in res" for every echelon and ground. | That is the guide's **Bn** res. A Div res holds the LAT Bn (GSP-1947 s27 para 3 p 122); res strong in armr, as mobile as the En (OoW Vol I pp 18-19). Mountains: little value upwards of Bn lvl from one central loc (MW p 169), split (GSP-1947 p 176). Desert: a third or more, mainly armr, down to Bde (DW p 26), within 2-6 h (p 27). | A Bde's res drafted from OoW Vol I with GSP-1947 beside; the ground's rule added in mountains and desert. |
| F3 | `writeLayoutDef` Armr | HAT "in the FDL gaps on the tk apch (Lt and Cen)": spread over every tk apch. | A tk wpns for the greatest density at the most vital area, never an even distribution (IBB p 73); ATGMs in bulk (OoW Vol I p 26); in desert on the most threatened tk apch, no dissipation (DW p 58). | HAT in bulk on the most threatened tk apch; the others only by what reaches them. |
| F4 | `writeTimeReq`, engine `mx.time` | The M fd took the shorter of hand and MML on any ground. | Mechanical mine laying is not successful in loose sand: MMLs on the dhars, by hand on the soft sand (DW p 65). | In a desert AOR the hand time drives (`minesHours`), said in the row and the basis. |
| F5 | `layoutDef` | A Bde's depth line looked for at the guide's Bn 3-5 km; no Bde frontage at all. | A Bde 10-12 km wide, 4-6 km deep, "only a yardstick" (OoW Vol I Annex B p 103); on a DCB up to 8,000-10,000 m (GSP-1947 s26 para 5 p 119), all three Bns three up (pp 120-121). | Bde depth 4-6 km; the DP 1 FDLs say the Bde's front against the yardstick (or the DCB figure along a 24 m+ water line). A Bn's normal depth 2-3 km (p 277), App 6's only on an extended front. |
| F6 | `AprcModel` (climb), `AprcBooks.MW_LIFT` | Climb rule cited MW Annex F **p 312**; the def's amn lift 123 mules with no remark. | The 1 h per 350 m is on **p 313** (para 3 c). The amn table prints 123 but its rows add to 101 (pp 322-323). | p 313 para 3 c; the basis says the rows add to 101 and the printed total is kept. |
| F7 | `writeAttkDir` FUP | "1000-1200 m (IBB p 201)" on every ground. | In mountains no classic FUP: the troops do not form up in extended lines, they cross a designated place at H (MW p 85); with NVDs outside the eff range of MGs, behind cover (MW p 228); IBB's distance is the plains', less in broken ground (IBB p 203). | Mountain wording when the AOR is mountains; the plains' otherwise. |
| F8 | `writeAttkDir` dir of attk | Flanking first on the user's rule and Mechs only. | Mountains: frontal attacks have little chance, attack along ridges and spurs, objs the hill features on either flk (MW pp 78-79). Desert: his flanks and LOC, dir by tk going (DW pp 34, 38); envelopment the most common (OoW Vol II p 68). | The ground's rule joins the flank rule. |
| F9 | `courseDef` | Course A counted one Coy a BUA on the FDL line, so a canal line with two BUAs read "2 Coys" against DP 1's three up. | As F1. | Course A takes DP 1's Coys up when the line has fewer BUAs ("and one more on Line W"); a plan's own posns still win. |
| F10 | `writeLayoutDef`, `courseDef` | "Line W (Along Hakra Branch) along Hakra Branch". | n/a | The obs is not named twice when the line's name already says it. |

## 2. Additions (book rules the module lacked; drafted where the reading can tell, else heads to consider)

| # | Where | Book | Added |
| --- | --- | --- | --- |
| N1 | attk `gr.ded.c.phases` | IBB S47 para 17 a p 248; GSP-1947 p 86 para 12 d, p 87, p 88; OoW Vol II p 36; DW p 47; MW p 82 | Aslt frontage by ni by echelon (Coy 250 m, Bn 450-650 m, Bde 1,100-1,500 m; desert 3,000-4,000 m; mountains compact), by day wider, desert ni half the day's; thinking two down; mountain phases with liberal timings. |
| N2 | attk AP-1, `own.ded.c.hold`, `gr.ded.c.pnr`, `gr.ded.c.reorg` | GSP-1947 pp 84, 89, 90, 91 | Main and secondary attk; a prelim op to clear his outposts; an aslt across an obs at a minimum of two places; reorg at once, tks stay till the RRs are sited. |
| N3 | attk `en.caps`, `en.ded.ap1.block` | GSP-1947 p 83 (IDD p 5 beside) | Indian res times: Bn a Coy 35-40 min, Bde a tk Sqn + two Coys 2-3 h, Div an Inf Bde + tk Regt less a Sqn 4-6 h, Corps 12-16 h. |
| N4 | def DP heads Adv / C Pen, `gr.ded.common` | OoW Vol I pp 13, 52; GSP-1947 p 104 paras 4-5, p 105 para 10, p 109 para 22 | Protective dets never so large as to weaken the main def, never reinforced; C pen posns planned and prepared at the outset; three echelons; main and secondary def effort, gaps covered by surveillance and counter-mobility. |
| N5 | def DP heads FDLs / Adv / C Pen / Res / Armr (drafted by the AOR's country) | MW pp 147, 150, 169; GSP-1947 pp 172, 175-176; OoW Vol I pp 71-72; DW pp 21-28, 58 | Mountains: dominating features astride the main axis, valleys blocked, M fds thickest in the valleys, res split. Desert: vital gr only with large gaps, held by fire, str pts adm self-sufficient, covering tps rather than an adv posn, C pen mode less preferred, ATGMs concentrated. |
| N6 | `visDef` | MW pp 164-165; DW pp 13, 27-28 | Mountains: the En punishes selected posts, multidirectional attks with infiltration. Desert: he outflanks the def; fight the battle outflanked, res within 2-6 h. |
| N7 | `writeTimeReq` guns row | MW pp 240, 244; DW p 60 | Towed guns singly / by sections near hairpin bends; in loose sand towed guns stick, SP ideal. |
| N8 | def `plan.adm` | DW pp 21, 85 | Posns logistically self-contained for a set time; str pts stocked with amn. |
| N9 | attk `ts.calc` | MW pp 80-81, p 81 para 7 b | Longer moves, time for guns / log / dumping, a reserve time; rates 3 km/h by day, 0.5-1 by ni, + 30-60 min per 300 m up. |
| N10 | wdr outline | GSP-1947 pp 143-149; IBB p 378; DW p 32 | Covering tps / rearguards; int posns where necessary; the reserve Bde prepares the rear main posn; denied until / no rearward mov always laid down; no posn left till the next is partially occupied. Desert: no wdr on foot, tpt to lift all, broad front, max routes incl cross-country. |
| N11 | def DP FDLs prompt | GSP-1947 p 119 para 5, pp 120-121 | A Bde on a DCB, all Bns three up. |
| N12 | attk FUP, Pnr, Timing, Armr, Reorg, Res | MW pp 82, 85-86; DW pp 38-39, 46, 48 | No classic FUP; no breaching, close in by boulders and nullahs; most attks at ni; a res on each axis; desert dir by tk going, tks under the inf at ni, reorg fast, res inf heavy for the break-in and mech for the break-out. |

## 3. Left as it was, and why

- The guide's figures that no pamphlet prints still drive where they did (the Vis timings, C pen 1,500 m, screens 1-1.5 km,
  FDLs 5-8 km past the border): the user's ruling of 24 Nov 2026.
- Coys up on a normal frontage still follows App 6's 4,500 m, the only printed relation between frontage and Coys up.
- A Div echelon: the Aprc reads Coy / Bn / Bde AORs only; GSP-1947's Div figures appear as heads (res, DCB) and beside the
  Bde's.
- Desert water as ITG, the desert prep stores and mountain digging time were done on 24 Nov (R79, R80, R88).
- **Thar read as Mountains (found here, fixed the same day in the Ground Guide):** `GroundGuideAor` read the AOR round
  Mithi (69.8 E, 24.73 N) as "Mountains", so the Aprc took the mountain rules there. Cause: the bundle's slope classes
  (sloping 7-15°, moderate 15-30°) count as mountain ground and the mountain test ran first; in the Thar they are dune
  faces. Measured within 5 km on the bundle: Mithi rises 77 m, sand 45 %, slopes 11 % (more in the AOR grid, which keeps
  the slowest class in each cell); Chachro 78 m; Nagarparkar (Karoonjhar) 309 m, slopes 43 %, sand 14 %; Muzaffarabad
  830 m. Fix (`aorCountry`, `_aorRelief`): slopes make Mountains unless the ground rises less than 400 m in 5 km
  (IpbTemplates mountainTest, E) and the desert classes pass 30 %: dunes 50-300 ft with a vertical slip face (DW pp 2-3).
  In the app: Mithi Desert (73 m), Chachro and Marot Desert, Nagarparkar and Muzaffarabad Mountains, Sialkot Canal plains;
  the Aprc at Mithi drafts the desert rules and its Gen Description says how far the ground rises.
  **Tightened the same day:** the Desert Warfare session's run found Islamkot (70.18 E, 24.70 N) still Mountains with the
  ground rising 72 m (its sand under 30 %). Now, whenever the relief is read, slopes make Mountains only on the mountain test
  itself (400 m in 5 km), the one the IPB templates, the gun / admin finders and the Plan Builder use, so the modules agree;
  lower slopes (dune faces, broken ground) leave the other classes to decide. In the app (Bde AOR): Islamkot Plains (72 m),
  Nagarparkar Plains (307 m: the Karoonjhar hills fail the 400 m test), Mithi / Chachro Desert (73 m), Marot Desert (23 m),
  Muzaffarabad Mountains (1,588 m), Mingora Mountains (858 m), Chakwal Plains (58 m). Tests: ipb-test desert.mjs G4
  (8 checks), aprc 389.

## 4. Tests and the app

`node tools/aprc-test/run.mjs`: 388 checks (356 before). 32 new "five ..." checks; two older ones changed with F3 (the HAT
in bulk) and the wdr prompt rule (GSP-1947 / DW / IBB pages accepted as book cites). `tsc -p tsconfig.build.json`: no
errors in the Aprc files.

Checked in the app (own Vite on :6564, real terrain bundle): a def Read at Marot, Cholistan (72.4 E, 29.17 N; Desert,
FDLs along the Hakra Branch): three Coys up along it, extended past 4.1 km, the desert DP 1 rules, the M fd by hand (72 h),
towed guns in loose sand, the outflanking step in the Vis. A def Read near Muzaffarabad (73.25 E, 34.15 N; Mountains): the
dominating features, the res split, the selective-punishment step. An attack Read at Ismailabad (Canal plains): the plains'
FUP rule, no mountain or desert words. Not seen in the app: a mountain or desert attack with approaches onto the obj (none
read without an own start marked); covered by the unit checks.
