# ORBAT re-check — 15 Nov 2026 (RESTD)

Every page of SO's Handbook (2019) Secs 1–7, 9, 10 and 13 was re-read as an image against the 14 Nov
extraction. Dense charts and tables were read at 200–400 dpi. `node tools/orbat-test/run.mjs`: 434 units,
200 weapons, 1,820 chart boxes (721 with a pers figure), 0 failed. The 8 warnings are all items the book
prints with no count.

The first pass had the printed figures almost all right. Most of the work was the **hierarchy**: every chart
box became a node carrying the figure printed in it and the wpns / eqpt / vehs written under it. Skipped pages
were extracted.

## New fields (all files)

| Field | What |
|---|---|
| `chartStrength` | Pers figure printed in the chart box. `strength` stays the table breakdown; they often differ (e.g. Std Inf Bn: chart 774, table 809) and both are kept |
| box `weapons` / `equipment` / `vehicles` / nested `children` | What the chart writes in or under a box ("2x MG", "1x RL", "(14 tks each)"), on that box, not only in a note |
| `appointments` | HQ appointments `{appt, rank, count}` (Div / Bde HQs, AD HQs, en Area / Sub Area HQ, Ord / EME units) |
| `ammoScale`, `echelons`, `radioSets`, `warIncrement.vehicles`, `heldState`, `weaponTable`, `seeUnit` | Per-unit tables from pages that were skipped or only summarised before |
| `infData`, `armrData`, `artyData`, `adData`, `avnData`, `movData` | Section-wide tables (new); `engrData`, `logData`, `sigData`, `threatData` extended |
| `weapons.json planRangeM.plan` | Planning range the book gives: Sec 2 own guns / mors / rkts 90 % of max (p 212 note); Sec 13 the printed Planning figure (Catapult 22 km, Bhim 32.96 km). `planRangeM.max` stays the printed max |
| `mov.json` (new file) | Sec 9: TC layout (two routes), Reg HQ, Sec Con (914–915); Mil Load Cl table (916) |

## Errors fixed

| File | Unit / item | Was | Now | Page |
|---|---|---|---|---|
| inf | inf-bde-hq vehicles | War Increment jeep 3/4 ton in the present vehicles | moved to `warIncrement.vehicles` | 605 |
| inf | inf-pl-std-atgm Med Range ATGM Launcher | no count | 4 (1 per det × 2 dets × 2 secs; = BS 4 on p 607) | 606–607 |
| inf | inf-pl-mtn-rifle LMG | no count | 6 (2 per sec × 3) | 612 |
| inf | inf-bn-mjd-mtn vehicles | Tlr 1/4 and 3/4 ton only in a note | 2 each | 639 |
| armr | armr-hq-div-log-armd-div EME Bn | linked to the revised EME Bn (p 1041) | the p 1037 org the Sec 1 chart draws (with Radar Repair Sec) | 101, 104 |
| armr | armr-tp-recce 14 Trks 1/4 ton | uncertain | troop total incl 2 Tp HQ trks (p 111, 117 agree) | 107 |
| armr | armr-recce-sqn Rifle Tp APCs | uncertain | 4 per tp (p 112; note (c) 35 APCs) | 109–112 |
| arty | arty-bty-med-sp weapon link | 155 mm How (towed) | 155 mm How SP M109 A2/A5 | 203 |
| arty | arty-regt-mlrs weapons | 18 launchers + 2 "MLV" rows of 6 (counted twice) | 18; State of MLRS → `heldState` | 206–207 |
| arty | arty-regt-mlrs att | 9 | att 6 + civ 3 (HQ Bty "3 + 3 (civ)") | 206 |
| ad | ad-regt-rbs70 / ad-tp-rbs70 weapon link | RBS-70 | RBS-70 BOLIDE (note 3, ammo row) | 312, 319 |
| ad | 5 Lt AD Regts strength | chart figure 446 / 491 / 464 / 469 / 387 | table TOTAL 498 / 544 / 514 / 552 / 430; chart kept as `chartStrength` | 320–321 |
| ad | ad-hq-aad-comd SD box | under Adm Branch | under Coord Branch | 301 |
| engr | 70 inline boxes | bare-number strength | `{total}` + `chartStrength` | 402–423 |
| engr | Offn / Def / Mech / Br bn Sig Pl, LAD | counted in the bn | `relation: att` (bn boxes add to 760 / 740 without them) | 402–412 |
| engr | engr-adv-search-sec, engr-eod-pl teams | strength 15 on a count-3 child | 5 per team | 418 |
| engr | engrData Inundation rows 9–10 | Loamy / Clayey Soils | Loamy Soils | 453 |
| engr | engrData MDS Emp Drill | item (4) missing | added (density 0.2 to 1) | 442 |
| sig | sig-bn-inf-div Cable WD-1/TT, S-4 | count 150 / 30 (a length as items) | qty 150 miles (241 km) / 30 miles (48 km) | 520 |
| sig | Corps Op Radio Coy, Armd Div Op / Radio Coys | sub-boxes flat | nested as drawn | 501, 505 |
| log | 81 chart boxes | bare-number strength | `chartStrength` | 1003–1035 |
| log | log-st-tpt-pl-inf-div vehicles | per-sec list on the pl | on the Sec box × 5 | 1003 |
| log | log-ftc children | "SC 35" + "SA 39" boxes | box (35-SC), one SA (39) sub-box | 1023 |
| log | log-air-desp-coy vehicleTotals | weapons 261 inside vehicle totals | `weaponTotals` | 1021–22 |
| log | Armd / Indep Armd Wksp Coy | Comp Wksp Pls beside Wksp Office | under Wksp Office | 1037–38 |
| log | logData Scale of Rat 16 | "15 lits or 300 cft per man per month" | K-11 oil 15 lits per cooker per diem, or Sui Gas 300 cft per man per month | 1098 |
| log | CONTENTS note | "about 5 ahead" | contents = printed page numbers | 1000 |
| en | en-armd-div / en-armd-div-arty | Recce and Obsn Flt under the Arty Bde | under Div HQ (att) | 1301 |
| en | en-mtn-div Postal / Div PU | two plain boxes | Div PU under Postal; top-row Div PU uncertain | 1305 |
| weapons | 12 Sec 13 planRangeM | upper eff dropped or above the lowest print | 2" Mor eff 480, 60 mm Mor eff 548, 57 mm RR max 4480, SMG 1A1 182, Catapult max 27000, Bhim max 41200, RL 84 mm 400 / 1000, Gren 36M 23 / 182, Prithvi 150 km, Tunguska 2000 (book: eff 3000 > max 2000, uncertain), Abbot 14900 | 1325–1349 |
| weapons | 155 mm Gun, 8 in How notes | — | "(SP) 30" Br Cl may be the 8 in How SP's; "action.5 to 6 hrs" ambiguous | 211 |
| weapons | added | — | SA-16 (p 319), RDMS Type-84 (p 440; no symbol key chosen) | |

## Added (counts)

- **Box figures:** chart boxes 1,450 → 1,820; with a pers figure 453 → 721. Inf 322 boxes, AD 48, Engr 108,
  Log 104 + 27 units, Arty 2 (the only Sec 2 chart that prints one).
  Sig, Armr, Avn and Sec 13 charts print **no** pers figures in boxes: theirs are in tables only.
- **Personal weapons:** Std Inf Bn Rifle G3 392, SMG/MP5 260, Pistol 59, grens, from the ammo table
  (p 650–651).
- **Skipped pages now extracted:**
  - **Inf:** radio layout (646), first line ammo (650–651), Def Brick (652), Mtn time formula (653–654).
  - **Armr:** echelons (115–118), ammo (119), planning (120), T-80 UD / Al-Zarrar tpt and POL (127–129),
    CCO (130).
  - **Arty:** Composn of Echs (216–218) on 14 units, ammo scales (213–214), Loc planning (225–226).
  - **AD:** C3 org (316).
  - **Engr:** M Fd Record, Eff Graph, Tac M Fd Reports (445–449); radio sets per box (454).
  - **Sig:** sets per station from the 7 radio diagrams (509–515).
  - **Log:** evac, rec, rpl, RP / ARP figures (1045–1064).
  - **Sec 13:** log system 1353–1368 (62 → 114 rows).
- **New units:** `log-st-tpt-pl-armd-div`, `log-st-tpt-pl-trk-tlr`, `mov-tc-two-routes`, `mov-reg-hq`,
  `mov-sec-con`.

## Still left out / doubtful (all marked `uncertain` or noted in the data)

- **Not given by the book** (so not filled in):
  - Avn: pers, armament and vehicles.
  - Sec 13: most box strengths, and the Inf Bde / Mtn Bde / Engr / Sig Regt compositions.
  - Engr: small arms.
  - Sig: weapons.
  - Arty: 19 units' strength.
  - Bn-level weapon tables for Mtn Inf Bn and MIB (only box weapons exist).
- **Book disagrees with itself** (kept as printed, both figures noted):
  - Std Inf Bn ATGM Pl: chart 36, boxes add to 20.
  - Armr Regt total 531 against rows 532; Recce Regt 588 against 587.
  - Std Inf Bn radio layout: 45 PRC-77 counted against 46 in the summary.
  - T-80 UD POL tables.
  - GLHMG printed 35 mm (p 649) and 40 mm (p 626, 628, 633, 651).
  - Armr Regt Sig Pl: 7 (Sec 1) against 6 (Sec 5).
  - The same Armd Div Med Bn appears in armr.json and log.json.
- **Read with doubt:**
  - Inf: Mtn Bn Mor Pl "4x81mm Mor" (per sec or per pl); DG Pl "(2xLMG)"; SSG Mtn table HSR / M4 rows.
  - Arty: Fd Regt RHQ 6 offrs (8 would make the totals add up).
  - Armr: radio diagram set types (VRC 79 / 78, "81U").
  - Sig: four radio diagram labels.
  - Engr: mech breaching columns (451).
- **Pure forms or worked examples, left skipped:**
  - Sec 2 Specimen FSP task table (219–221).
  - Log rft demand and cas report forms (1068–1069).
  - Sec 8 Int and Sec 11 SD forms.
  - Sec 9 move planning (901–913; see `MoveDoctrine.json`).
- **No symbol key** for the mov units (no TC / MP unit in Symbols.json) or for RDMS Type-84.
