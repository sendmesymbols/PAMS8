# IPB in the Ground Guide — the Extended View

Status: **proposal, 14 Nov 2026**. Nothing built yet. The six doctrine decisions in §3 are the user's, taken 14 Nov 2026.
**Revised the same day (user):** everything lives in the **Extended View** (F). It is worked out only while F is on and
dropped when it closes; its tabs may be replaced, merged, dropped or added; the Gr Scope rail (V) gets the same products.
Planned pages: `ground-guide-ipb-options.html` (mockup on synthetic ground, with the options to pick). §5 and §8 follow
this; the AOR scale (Shift+V) is left as it is. **v2 the same day** (§5a): refinements from six more books and the
declutter controls.
Related: `15-ground-guide.md` (Extended View, Gr Scope AOR scale), `OCOKA_Roadmap.md`, `PlanBuilder_Plan.md` (enemy
approaches, "no enemy doctrinal template yet"), `claude_rules.md` (terrain bundle optional).

**Handling.** This plan quotes figures from a RESTRICTED Command and Staff College pamphlet. Keep it under the same terms
as that pamphlet, as for `MS/Data/OcokaDoctrine.json`. Never commit an unlocked copy of the PDF.

---

## 1. Goal

The user recces and plans deployments by the C&SC Quetta IPB book. The Ground Guide already reads the ground under one
symbol (the Extended View, F). This plan brings the book's method into the Extended View, reading the area round the
symbol (the echelon's frame facing the threat), so that the planner gets:

- the **combined obstacle overlay** coded GO / SLOW-GO / NO-GO by the book's own criteria, with the reason for every
  patch;
- **mobility corridors** and **avenues of approach**, own and enemy, sized for the echelon, with crossover corridors;
- **observation and fire corridors** along each avenue;
- **air avenues of approach**, **landing and drop zones**, and AD sites along the air avenues;
- the **proforma** for the relative merits of the avenues;
- the **weather critical values** for the month;
- **doctrinal, situation, event and decision support templates** (NAIs, TAIs, decision points);
- all of it as **ordinary symbols** on the map ("Create on Map"), like the old system's "1-IPB" overlay.

### What it is not

- **Not a replacement for recce.** The output is a proposal plus a list of what was not assessed and what to confirm.
- **No enemy data.** The threat and the enemy's start points are what the user marks. Templates are, in the book's
  words (p 32), rough approximations, not fact; over-reliance invites deception.
- **Not the GROTBC rule.** The IPB overlay is the book's coding. The GROTBC card and enforce mode keep their own rule.

---

## 2. The doctrine

**Source:** *Intelligence Preparation of the Battle Field (IPB)*, Command and Staff College Quetta (Lt Col Riaz A
Toor), 32 pp, RESTRICTED. `Material/Literature/1. Books/11. Intelligence Preparation of the Battlefield.pdf`
(password-protected). To be read with GSP-1590 *Battle Intelligence 1978* (ch 10 s48, s50; ch 15 s74, s76) and GSP-1620
*Staff Duties in the Field 1981* (ch 3 s15 para 17; ch 4 s22, s23). Page numbers below are the book's printed pages
(they match the PDF pages).

| Subject | Book | What it sets |
|---|---|---|
| Air avenues of approach, LZ / DZ | s2 para 1, p 5–6, Fig 1 p 8 | Low-level and NOE. Factors: sufficient air space, concealment from ground observation, easily recognised features (rivers, roads; linear features parallel to the flight best; terrain corridors give navigation and defilade), length of flight path, vertical obstructions (water towers, power lines). Identify LZ / DZ and AD sites giving long-range, flank or bottom shots. |
| Combined obstacle overlay | para 2a(1)–(9), p 6–12, Fig 2 p 13 | GO / SLOW-GO / NO-GO per type of unit; cross-hatch NO-GO, parallel lines SLOW-GO. Applies to manoeuvre in combat formation, not movement through (that is the road network). Criteria in §6.1. |
| Mobility corridors, avenues | para 2a(2), 2b–d, p 7, 12, 16; Figs 3–4 p 14–15 | MCs two levels down, AAs one level down; at least two MCs to an AA; widths and spacing in §6.2; crossover corridors; AAs drawn through the area of interest regardless of boundaries, may start or end abruptly, never extended through ground with no MCs. |
| Observation and fire corridors | para 3, p 16–17, Fig 5 p 17 | Overwatch along the avenue both ways; range fans of direct-fire weapons from likely or known defensive positions; long-range acquisition, air and indirect fire for deep operations. |
| Unopposed rates of movement | para 4, p 18 | Foot GO 4 / 3.2 km/h day / night, SLOW-GO 2.4 / 1.6, NO-GO 1.0 / 0.1–0.5. Vehicles GO 24 / 24 (night with lights or passive), SLOW-GO 16 / 8 (night blacked out), NO-GO 1.0 / 0.1–0.5. |
| Weather effects critical values | Annex A, p 19–20 | GO and marginal values per mission (§6.6); worse than marginal is unfavourable. |
| Proforma, relative merits of AAs | s3 para 1, p 21 | Rows a–l, two groups of A B C D (§6.5); + advantage, − disadvantage, add up; totals are only a rough guide. |
| Templates | s3 para 2, p 22–32; Figs 6–10 p 25–31 | Doctrinal, situation, event, decision support (§6.7). Decision while the enemy is at least **2 h** from the TAI (p 30). Fig 8 is cut off in the PDF (title only). |
| Targets for interdiction | s3 para 3, p 32 | HVTs chosen jointly by intelligence, operations and fire support staffs. |

**Where the book's tables come from** (checked online, 14 Nov 2026):

- The GO / SLOW-GO / NO-GO lists and the vehicle rates follow **FM 34-130** (1994) Fig B-6 *Terrain types for
  mechanized or armored forces* (slope in %, stream depth / current / width against AVLB length, tree spacing and trunk,
  roads and trails per km, 24 / 16 (8 at night) / 1 (0.4 at night) km/h).
- The corridor widths and spacing are FM 34-130 Figs B-17 and B-18, and the current **ATP 2-01.3** (March 2019, C1
  January 2021) Table 4-2, p 4-9: *typical widths of mobility corridors for a mechanized force*. Para 4-26 adds that
  dismounted forces can use more restrictive corridors. The book prints the same table "for dismounted infantry".
- Also in the repo: FM 5-33 *Terrain Analysis* (`Material/fm5-33(90).pdf`), for cross-checks.

---

## 3. Decisions (user, 14 Nov 2026)

1. **Going rule: follow the authentic source.** The IPB overlay uses the book's criteria only. It is not combined with
   GROTBC, and a criterion the bundle cannot test is listed as *not assessed*, never filled in from GROTBC.
2. **Proforma groups.** The book (p 21) puts two groups of A B C D under "Avenues of Approach" and leaves both group
   headings **blank**; its sample signs sit in group 1, column B. The sheet keeps two groups with blank headings that
   the user names. (The only own / enemy split in the book is Fig 3, own AAs, p 14, and Fig 4, enemy AAs, p 15.)
3. **Communications (row h)** means roads / LOC or signals by context: two lines, *Rds & LOC* and *Sigs*.
4. **Corridor widths for mechanised and armoured units:** ATP 2-01.3 Table 4-2 gives the same figures for a mechanised
   force, so one table serves all: widths Div 6 km, Bde 3 km, Bn 1.5 km, Coy 500 m; spacing 10 / 6 / 2 km.
5. **GO slope is "less than 30 degrees" as written** (p 11). SLOW-GO (30–45 %) and NO-GO (≥ 45 %) are in percent and
   uphill only. How the overlap is handled is in §6.1.
6. **AVLB span:** not known. A setting, default **18 m** (M60 AVLB bridge, 18.28 m; basis T), shown with "confirm
   with engineers". Open lists (unconfirmed) put the M60 AVLB and an Al-Khalid AVLB in Pakistani service; no span is
   published for the latter.

Working rule from these answers: implement figures exactly as written, cite the page, and show conflicts with their
source rather than correcting them. Where the book is silent, look the figure up in authoritative doctrine and cite it;
only if nothing exists use a marked proposal (basis T / E).

---

## 4. What exists and is reused

| Need | Reuse | Notes |
|---|---|---|
| Going per mover | `rules.json` classes and 14 profiles, overlay paint | The GROTBC coding; stays as it is |
| Trace marking | AOR Trace style (Vs72: NO-GO crisscross, SLOW-GO parallel lines) | Same marking as the book's Fig 2 |
| Approach search | `findAvenue` (`GroundGuideOcoka.ts`) | NO-GO never crossed, SLOW-GO dearer, width = 2 × distance to NO-GO, chokepoints |
| Area reading (code to reuse) | `readAor` (`GroundGuideAor.ts`): class grid that keeps canals and bridges, crossings, places, roads, BUA / tree band per approach | The AOR scale itself is not changed |
| Threat | `GroundGuideThreat.ts` marker, `extended.threat` | Docked = bearing, dragged = place |
| Sight | `analyseSight`, `sightTo`, `ocokaSight`, `ocokaViewshed` | Chance, not yes / no; buildings, crops by month, trees |
| Key ground | `rankKeyGround` (`GroundGuideExtendedView.ts`), bundle ITG candidates, `designateGround` | Candidates only |
| Cover and concealment | C letter (`GroundGuideCover.ts`), `cc`, crop calendar | |
| Road density | `GroundGuideRoadDensity.ts` (`roadDensityAround`) | km/km², all-weather share |
| People | `GroundGuidePopulation.ts` | For row k |
| Speeds | `MovementSpeeds.json`, `GroundGuideSpeed.ts` | The book's rates become an option beside it |
| Weapon ranges | `Rng` in `Symbols.json` (90 entries) | Fans |
| Weather | Visibility grid (GSOD, monthly), climate grid (WorldClim 2.1: tmin, tmax, tmean, prec, wind, flags) | Annex A rows |
| Features | `features/` kinds: helipad 40, airfield 41, air base 42, landing strip 43, airport 44, landing ground 45, runway 46, road runway 47; overhead water tank 9, mast 78, wind tower 79, chimney 122; ford 26, ferry 25, bridges 20–30; pass 55, saddle 163; junctions 159, 166 | Attributes: width `w`, depth `dp` / `dm`, current `cu`, bank `b` / `bk` where recorded |
| Classes | wire hazard 33 (power lines), canal 20, distributary 21, drain 22, stream 46, water 4 / 5, wetland 6, built-up 3, forest 31, orchard 30 | |
| Profiles | `hls`, `ad`, `signals`, `tracked`, `wheeled`, `dismounted` | LZ, AD sites, relay sight |
| Symbols on the map | Obstacle symbols (Extended View already reads them), boundaries, VG / IG | |
| Creating symbols | `SymbolEngine.loadSymbolFromJSON` | As the Mov Guide's "Create on Map" |
| Symbols needed | No Go 25120203, Slow Go 25120202, Mob Corridors 25110101, Avenue of Apchs 25120204, NAI 25120200, TAI 25120201, Decision Pt 25130700, Landing Zone 25242304, Drop Zone 25060000, Engagement Area 25151300 | All in `Symbols.json` |

### Gaps found

1. **Corridor widths are proposals today** (the Extended View sizes approaches to the frontage; the AOR's `aor.corridorM:
   0` → Coy 1 km, Bn 2 km, Bde 4 km). The book and ATP give doctrine figures (§6.2). The AOR keeps its own until decided.
2. **No Div frame.** The echelon frames are Coy / Bn / Bde; Demo 2 (the validation case) is a Div IPB.
3. **Only enemy approaches.** The Extended View's approaches run from the threat; the book wants own AAs (Fig 3) and
   enemy AAs (Fig 4).
4. **One path, not corridors.** `findAvenue` gives the cheapest path (and a second); the book builds AAs out of MCs.
5. **Nothing for air, proforma, weather matrix, event or decision support.**

---

## 5. Where each piece goes: the Extended View (user, 14 Nov 2026)

Everything is in the Extended View. The Detail's tabs answer in the order a staff officer works: where can I see and
shoot · what ground matters · how can the enemy come · from the air · when must I decide. Mockup with both layouts and
every picture: `ground-guide-ipb-options.html`.

**Tabs (layout A, recommended; layout B folds Key Gr into Apchs: four tabs).**

| Today | Planned | Change | What |
|---|---|---|---|
| 1 Obsn & Fd of Fire | **1 Obsn & Fire** | augmented | Page 1: *Fire Corridors* map (fans from every own Posn over the Apchs, dead red, screened amber), *Coverage Along Each Apch* (ribbon per Apch: under fire, dead, screened, out of range; the gaps named), *Fd of Fire by Range* (kept), *Wx for Fire* (Annex A rows). Page 2: What May Be Seen, Threat's View, Better Posn, Obsn (kept). |
| 2 Key Gr | **2 Key Gr** | kept | Candidates gain chips from the area reading (On Apch A, Overlooks NAI 2, Covers TAI 1); proforma row d reads it. |
| 3 Approaches | **3 Apchs** | replaced | Page 1: *Gr Overlay, Mob Corridors & Apchs* map (the book's coding in Trace marking, Mob Corridors, Apchs, crossover, narrows), *Width Along Each Mob Corridor* (against the doctrine line), *Proforma* (a–l, two groups with user-named headings). Page 2: *Why NO-GO / SLOW-GO* (the 8 criteria), *Wx for Mnvr*, *Time Over Each Apch* (book rates), *Straight Ways Out* (kept, smaller). |
| Stopped By (tile) | merged into *Why NO-GO* | merged | |
| Weather & Light (tile) | split by tab | moved | Annex A rows where they matter: Wx for Fire (1), Wx for Mnvr (3), Wx for Air (4); light and night sight stay in 1. |
| — | **4 Air** | new | *Air Apchs, LZ / DZ, AD Sites* map, *Flight Profile* (ground, flight band, obstructions, the stretch the threat may see), *LZ / DZ ranked*, *Wx for Air*. |
| — | **5 Decision** | new | Page 1: *Time Ladder* (en along each Apch at the book's rates; NAIs, TAIs, a DP 2 h before each TAI; day / night; a strip-per-Apch style as an option), *Decision Support* map, *Decisions* table. Page 2: *Situation Template Check*, *Event Matrix*, *Templates in the Library*. |
| O and C tiles | kept | kept | Obs Toward the Threat, Concealment in Crops. |

Known layout issue: with layout A the tab row (6 GROTBC + 5 + Legend) wraps to two lines below about 1650 px; layout B,
or dropping the GROTBC tabs' answer line while F is on, keeps it to one.

**When it is worked out (user: only while the Extended View is on).**

| When | What | Cost |
|---|---|---|
| Every mouse move (≤ every 60 ms) | The spot, as today: fan, dead / screened Gr, lines of sight | ~6 ms (measured) |
| Cursor rests 220 ms | Better Posn; which Apch and Mob Corridor the spot sits on; how much of each Apch the spot's weapon covers | ~20 ms (est.) |
| Once per area | When the cursor leaves the area read, or the threat, echelon or month changes: the book's coding, Mob Corridors, Apchs, proforma suggestions, times, NAI / TAI / DP. In the tile worker, cached per area. | ~150–300 ms (est.) |
| Only when shown | Fire corridors from every Posn on the map, air Apchs, LZ / DZ, AD sites, template check: only while their tab, rail line or map switch is open | ~50–200 ms each (est.) |
| F off | Closing the Extended View (F, a new kind of symbol, Esc on the draw, the guide off) stops everything, drops every cache and clears the map layer | 0 |

The area read is the echelon's frame facing the threat, from the spot (Bn 7 × 12 km, Bde 14 × 18 km, a Div frame added).
The level follows the book (p 7): a Bde HQ reads Bn Apchs of Coy Mob Corridors; a Div HQ Bde Apchs of Bn Mob Corridors.
While a line or area is drawn the Extended View rests, as today.

**Other surfaces.**

- **Gr Scope rail (V)** in the Extended View: the bar keeps the GROTBC verdict; the map widens to the area read; the
  answer lines give the likely Apch, its narrows and the first DP; the legend lines become the five products (1 Fire
  corridors, 2 Key Gr, 3 Gr overlay & Apchs, 4 Air, 5 NAI · TAI · DP), each a switch.
- **The map** (the Extended View's layer): the same products on the ground, each with its own switch; options for the
  Apch style (broad arrows / corridor lanes / both) and the overlay paint (Trace hatch / soft tint).
- **The cursor card:** the Ext block gains *En Apchs* (the likely one, its narrows) and *Decide* (the first DP).
- **Create on Map:** writes any product as ordinary symbols (§6.8).
- **Copy as Text:** the Extended View's lines gain the IPB paragraphs (Apchs, proforma, decisions, event matrix).

Keys: F, Shift+F, 1–5 for the tabs while F is on (check against the digit keys other guides use), [ ] turn the threat,
J better Posn.

### 5a. Version 2 (14 Nov 2026): refinements from six more books, and declutter

After reading ATP 2-01.3, Infantry Bn in Battle, Desert Warfare, Mountain Warfare and Operations of War Vol I and II
(rules kept in memory, not in files), the mockup became v2. What it adds:

- **The threat is the existing threat marker** (`GroundGuideThreat.ts`): placed = the en's start (time ladder and DPs
  measured from it; if a DP falls beyond it, ask to drag it to the en assy area); docked = the direction of attack;
  `sectorDeg` = how far a Mob Corridor may turn from it (90° → ±45°); [ ] re-read once; all round = the best Apch per
  quarter (proposal). The time ladder reaches the tactical Area of Interest (up to 100 km / 2 days, OoW II s2).
- **MS symbols:** Apchs drawn as the open-back attack arrows (MainAttack `25151403` for the most likely, with the inner
  line; SupportingAttack `25151404` dashed for the others), shape as `MainAttack.ts createComplexArrow` (half-width =
  tail × (length to go + total ÷ 2.4), head 15 %). Also Penetrate `25341800`, Counter Attk `25340600`, Infiltration Lane
  `25140800`, Assy Area `25150200`, Attack Position `25151600`, Support by Fire `25152100`, Battle Posn `25151200`, Block /
  Disrupt / Turn `25270501/502/504`, Fix `25341100`, Phase Line `25140300` (time phase lines), Engagement Area
  `25151300` (killing areas); echelon marks from `Echelons.ts`; unit icons in pictures from milsymbol (`asSVG`).
- **Tab 3 page 2 · Manoeuvre and attack** (new): *Forms of Manoeuvre* picture and *Open-flank Test* (are the defence's
  flanks anchored on NO-GO, or is there GO ground round them? → penetration / envelopment / double / turning (deep
  objective + mobility edge) / vertical (en LZs behind FDLs) / infiltration (dead-ground lane within one night: 15 km in
  hills)); *Apchs at a Glance* (type for the terrain: plains corridor, desert axis, mountain valley / nullah / ridge-line;
  capacity; the five ATP criteria as chips; most likely and most dangerous); *Attack Type & Timing* (day / night / dawn /
  dusk from sun and moon; armour- vs infantry-heavy from the ground; night: frontage and depth halve, FUP 1000–1200 m).
- **Tab 1:** *Killing Area Candidates* (where an Apch narrows under observed fire, no cover for the en, in AT range;
  obstacles must not mask own fire or block own counter-attack routes, Vol I pp 42–45); identification ranges (ATP B-14).
- **Tab 2:** key / decisive (ATP 4-11) / vital Gr (Vol I p 16) with chips; key Gr by terrain; counter-penetration sites.
- **Tab 4:** en heliborne LZs behind own FDLs with OPs over them (Vol I pp 61–63); mountain helipads ≤ 4°, desert dhars.
- **Tab 5:** two DP rules: interdict 2 h before the TAI (IPB p 30) and **counter-attack while the depth localities still
  hold** (Vol I p 54; Coy CA 30 min from decision); COA 1 most likely and COA 2 most dangerous side by side; time phase
  lines; page 2 *Template Phases* from the books (Desert pp 10–13: SZ 24–48 h, two lodgements, break-out at first light,
  7–10 days; OoW II s14: bridgehead 8 × 6 km; Vol I Annex E: Proactive Ops, 8–12 IBGs).
- **Season rules** (Rann impassable Jun–Nov; > 2500 m blocked 6–9 months; snow slopes > 35°, > 25° after fresh snow):
  in the coding or as notes, a switch until the user decides. **Foot rates by terrain** (IBB p 18; Mountain p 81).
- **Overlay paint** gains an *ATP green* option (ATP 4-14) beside the Trace hatch and soft tint.
- **Own attack: Left or Right** (user, 14 Nov 2026: "Frontal attack is dangerous and have small chances of success,
  Flanking attack with choking enemy MSR is encouraged, can go right / left approach by weighing different factors").
  Tab 3 gains a page *Own attack: Left or Right*, shown when the reading is for an own attack (a *Read for: Defence / Own
  attack* switch in the mode line, or an attack symbol being placed):
  - **Frontal is discarded** (labelled "dangerous, small chance of success"; shown only for reference). IC s15.12's own
    quick appreciation says the same: the front "may be safely discarded", so the ground is split into Left and Right.
  - **The en MSR choke point** behind the en position (a bridge, junction or defile on his MSR / LOC) is found and the
    approach that reaches it is preferred.
  - **Left vs Right weighed:** factors = IC s15.12 b (FUP location, cover, obstacles FUP → objective, distance; route to
    FUP: obstacles and en interference; fire base: cover, range, direction of fire against the direction of attack) +
    choke the en MSR + going + surprise; each scored 1–5 with its reason; **weights set by the user** (0–3, default MSR
    choke 3); weighed % per approach. Plus IC s15.12 c time and space to H hour (route time, unforeseen 5–10 min, 2 min in
    the FUP) and the forms for an own attack ranked (flank + MSR choke first, penetration only with preponderance,
    frontal last).
  - On the map: layer *Own attack: Lt / Rt / frontal* (recommended flank as MainAttack, the other as SupportingAttack,
    frontal greyed and struck through, FUPs, fire bases, the MSR choke marker) and an *Own attack* preset.
  - For the enemy reading the same logic makes a flank move that chokes **our** MSR the most dangerous COA.

**Declutter (user, 14 Nov 2026: "users should be able to declutter by hiding and showing different components").**

| Control | Where | What it does |
|---|---|---|
| Product switches | Settings / Ctrl+K, the Detail | Fire corridors, Apchs, Manoeuvre, Air, Decision. **Off = not worked out**; its tabs, tiles, map layers and rail line go. Kept per user. |
| Presets | Map layer panel, rail foot | Minimal (default: Apchs, narrows, own Posns, threat) · Approaches · Manoeuvre · Defence · Decision · Air · All |
| Layer switches | Map layer panel, grouped | Ground (coding, not assessed) · Approaches (arrows, corridors, narrows) · Manoeuvre (forms, obstacle effects) · Fire (fans, killing areas) · Key Gr · Air (air Apchs, en LZs) · Decision (NAI/TAI/DP, time phase lines, CATK route) · Own Posns |
| Focus | Map, rail | One Apch at full strength, the others at a fifth |
| Labels | Map, rail | Auto (decision items only, default) · All · Off |
| Tile eye | Every Detail tile | Hide a tile; it becomes a chip in the foot; the others close up (fewer pages) |
| Rail lines | Gr Scope rail | Each line is a switch (1 Fire, 2 Key Gr, 3 Gr & corridors, M Manoeuvre, 4 Air, 5 Decision) |

---

## 6. Products

### 6.1 Combined obstacle overlay (the book's coding)

Coded per type of unit. The book marks some criteria *armoured forces only* or *mechanized forces only*; the rest apply to
every unit. Proposed mapping (to confirm): armoured = `tracked`; mechanized = `tracked` APC / IFV and `wheeled`;
dismounted = `dismounted`.

| Criterion | NO-GO (p 9–10) | SLOW-GO (p 10–11) | GO (p 11–12) | Bundle test | If the data is missing |
|---|---|---|---|---|---|
| Built-up areas (armour) | Wider than 500 m or not easily bypassed on both sides | — | — | `built_up` + `bld`: blob width across the direction of movement; bypass = room on both flanks | — |
| Hydrology | Not fordable and not spannable by AVLB, not frozen; hard vertical banks > 4 ft (1.22 m); velocity > 5 ft/s (1.52 m/s) **and** depth > 4 ft (as written; FM 34-130 B-6 lists them separately) | Fordable or spannable in several places; < 5 ft/s and < 4 ft; ice 31.5 in carries tanks, 20 in howitzers | Fordable anywhere or ≤ 5 ft (1.52 m) wide; depth < 2 ft (0.61 m); ice ≥ 4 in for dismounted | Water classes 4–7, 20–22, 46; feature `w`, `dp` / `dm`, `cu`, `b` / `bk`; fords, ferries; AVLB span setting | Cell marked *not assessed: width / depth / current not recorded* |
| Slopes | ≥ 45 % uphill (directional) | 30–45 % uphill (directional) | < 30 degrees | Slope along the direction of movement from `elev_hi` / `elev_lo` (30 m) | — |
| Vegetation | Trees 6–8 in thick at < 20 ft (armour) | Trees "2 –" in (the page drops the upper figure; FM 34-130 B-6: 2 to 6 in) at < 20 ft (mech) | Trees < 2 in or > 20 ft apart | Classes 1, 29, 30, 31 only; no trunk or spacing data | Cell marked *not assessed: tree thickness not recorded* |
| Elevation (relief) | 200–400 m per km | 100–200 m per km | 0–100 m per km | Max − min elevation in a 1 km window | > 400 m/km is not classed by the book (the slope test will usually class it) |
| Man-made obstacles | Minefields, tank ditches, blown trees, barriers (may be directional) | — | — | Obstacle symbols on the map; DCB and AT ditches are not in the bundle | — |
| Roads and tracks (armour, except open areas) | One track per km and no hard road | One hard road, or two tracks, or one road and one track per km | Two or more hard roads per km; slope beats roads; roads negate vegetation unless obstacles are employed | Network: metalled = hard road, unmetalled = track; per km in a 1 km window (interpretation, E); open areas = open land, crops, desert | — |
| Water table | < 5 ft | 5–10 ft | > 10 ft | Not in the bundle | Listed once on the sheet as *not assessed for the whole area* |

**Slopes, as written (decision 5).**

- **Uphill:** SLOW-GO 30–45 % (16.7–24.2°) and NO-GO ≥ 45 % (24.2°) overlap GO "< 30°". Where they overlap, the
  stricter class wins; this gives the same answer as reading GO in percent.
- **Downhill or across the slope:** the SLOW-GO and NO-GO slope rules are uphill only, so GO < 30° decides.
- **Downhill 30° or more:** not classed by the book. It gets its own mark, *not classed by the book*, so it is never
  painted as free ground.
- The direction of movement is the AA's direction: threat → MITG for enemy AAs, toward the enemy for own AAs.

**Combining.** A cell takes the worst class that any tested criterion gives it. *Not assessed* is shown only where the
missing data is local (trees in a forest cell, an unrecorded river); data missing everywhere (water table) is listed
once on the sheet. Every patch carries its reason: "NO-GO: slope 52 % uphill toward the threat", "NO-GO: BUA 1.3 km wide,
no bypass", "SLOW-GO: relief 160 m per km". The book's caveats ride along: NO-GO does not mean impassable, and the
coding applies to manoeuvre in combat formation, not movement along roads.

### 6.2 Mobility corridors and avenues of approach

**Echelon logic (p 7):** MCs two levels down, AAs one level down from the HQ.

| HQ | AA for | MC for | MC width | Max distance between MCs |
|---|---|---|---|---|
| Corps | Div | Bde | 3 km | 10 km |
| Div | Bde | Bn | 1.5 km | 6 km |
| Bde | Bn | Coy | 500 m | 2 km |
| Bn | Coy | Pl | not given | not given |

Widths: book p 12 and ATP 2-01.3 Table 4-2 (Div 6 km, Bde 3 km, Bn 1.5 km, Coy 500 m). Spacing: book p 12 and ATP
Table 4-2. For a Bn HQ neither source has a row; the Extended View shows the Bde HQ row and says so.

**Method:**

1. Code the area read (the echelon's frame facing the threat, plus a lead beyond it toward the threat) by §6.1 for the
   mover.
2. **MCs** are relatively open ground the unit can move through deployed: GO ground whose width (twice the distance to
   the nearest non-GO cell) is at least the MC width. Trace their centre lines (the ridges of the distance field) and
   keep segments running in the general direction of attack (within ±45°, E).
3. **AAs** combine two or more MCs running the same way whose neighbours are no farther apart than the spacing. An AA
   with one MC is not viable and is shown as a lone corridor. SLOW-GO and NO-GO may lie between MCs inside an AA; an AA
   is never extended through ground with no MCs.
4. **Crossover corridors** are MCs within the spacing that join two AAs.
5. AAs are drawn through the whole area of interest, **regardless of boundaries, objectives, FDLs, line of advance or
   contact**, and may start or end abruptly (p 16).
6. **Own and enemy:** enemy AAs run from the threat toward the MITG; own AAs run from the own side toward the enemy.
7. Rank and lettering: A, B, C… by the proforma totals (§6.5), the old ranking (shortest past the border, least
   friction) as a tie-break.

The chokepoints, crossings, places, roads and the BUA / tree band per approach that `readAor` works out today are reused per AA.

### 6.3 Observation and fire corridors

- **Fans** for every own or enemy position symbol in the area (by its `Rng`), plus the ITG candidates and the lines of
  defence as *likely* positions (p 17, Fig 5). Clipped by sight: dead ground and screened ground shown as in the
  Extended View.
- **Per AA:** the share of its length under direct fire from the defender's positions, and where along it the attacker
  can overwatch; long-range acquisition (radar and OP ranges from `OcokaDoctrine.observation`) for deep operations.
- In the Extended View tab 1: which AAs the position's fan covers and for how far.
- Feeds proforma rows a and j.

### 6.4 Air avenues, LZ / DZ, AD sites

- **Air avenues** (p 5–6): least-cost low-level routes from a start (own side or enemy side) to an objective or LZ.
  Cost: ground observed by the other side (`ocokaViewshed` from the threat or from positions), distance to vertical
  obstructions (overhead water tanks, masts, wind towers, chimneys, power lines), length. Cheaper: valleys (terrain
  corridors, defilade) and rivers, canals, roads and railways lying parallel to the flight. Air space: positions,
  gun-target lines and restricted-operations symbols on the map. Two or three ranked air avenues, with the reason for
  each.
- **LZ / DZ** (p 6, Fig 1): `hls` GO ground, clear of obstructions, concealed from enemy view, near the objective; the
  existing helipads, airfields, landing grounds and road runways first.
- **AD sites** (p 6): `ad` GO ground within the AD weapon's range of the air avenue, scored for long-range (down the
  avenue), flank (beside it) and bottom (below where it crosses a ridge) shots.
- **Weather:** Annex A rows for airborne and rotary wing (§6.6).
- **Tab 4 Air** in the Extended View: the air avenues, LZ / DZ, obstructions and AD sites in the area read, with the
  flight profile of the leading air avenue; the rail's line 4 and the map draw the same.
- Not in the book, to look up before this phase: low-level and NOE flight heights (FM 3-04 series) and LZ sizes for the
  aircraft in Pakistani service (FM 34-130 Fig B-13 gives minimum helipad sizes for US aircraft only).

### 6.5 Proforma for the relative merits of AAs (p 21)

A tile in Extended View tab 3 (Apchs) and a block in Copy as Text. Two groups of A B C D with blank headings the user names
(decision 2), and a *Notes* column. Each group also says whose avenues they are (own or enemy), because each sign
depends on the side using the avenue; this is our addition, not the book's.

| Row | Measure suggested from the data | Notes |
|---|---|---|
| a Observation & fire | Overwatch share for the user of the AA against the share under the other side's fire (§6.3) | |
| b Cover & concealment | Cover and concealment along a 1 km band (C letter, `cc`, crops of the month, trees, BUA) | |
| c Obstacles / vertical | Water lines, canals, NO-GO BUA crossed, with bridges and fords; vertical obstructions on air AAs | |
| d Important tactical ground | ITG candidates on or overlooking the AA | Who holds them is the user's call |
| e Manoeuvre space | Number of MCs and their narrowest width against the doctrine | |
| f Ease of movement | GO / SLOW-GO / NO-GO shares, time at the book's rates, crossings | |
| g NBC effects | Low ground where agents linger, the month's wind | User signs it |
| h Communications | Two lines: Rds & LOC (metalled roads, rail, laterals, bridges) and Sigs (radio line of sight along the AA) | Decision 3 |
| j Surveillance | Share of the AA seen from OPs, ITG and radar ranges | |
| k Unconventional warfare | People and settlements along the AA | User signs it |
| l Others | — | User |

Signs: the data suggests + or − by comparing the AAs (at or above the median of the group: +, below: −; E), each with
its reason; the user flips any sign; rows g, k and l are left to the user. Totals per AA, with the book's note 2 printed
under the table: the weights cannot be quantified, so the totals are only a rough guide.

### 6.6 Rates of movement and weather (p 18, Annex A p 19–20)

- **Rates:** an option `speed.rates: book` beside `MovementSpeeds.json`, used for AA time-distance, the event template
  and decision points: foot 4 / 3.2, 2.4 / 1.6, 1.0 / 0.1–0.5 km/h; vehicles 24 / 24, 16 / 8, 1.0 / 0.1–0.5 km/h.
- **Weather critical values tile:** for the month and place, each Annex A row coded GO / marginal / unfavourable from
  what the bundle has.

| Annex A element | Bundle | Status |
|---|---|---|
| Visibility | Visibility grid: monthly mean, % of days under 2 km, haze, fog | Partial: daily means, not the hour |
| Temperature | WorldClim tmin / tmax / tmean | Yes |
| Wind chill | tmin + wind | Yes (estimate) |
| Surface wind | WorldClim monthly mean wind | Partial: means, not gusts |
| Rainfall rate (in/hr) | Monthly totals only | Not assessed |
| Snow depth | — | Not assessed |
| Ceiling, cloud cover | — | Not assessed |
| Humidity, stability | — | Not assessed |

Rows the bundle cannot answer say "get from Met".

### 6.7 Templates (p 22–32)

- **Doctrinal templates** (p 22): enemy deployment without terrain or weather (composition, frontages, depths, equipment,
  HVTs). A library `MS/Data/IpbTemplates.json`, basis per figure: Fig 6 (p 25) Indian Army Div defence of a Ditch-cum-Bund
  (80 km frontage; depth bands 20–25 km; 33 / 50 / 17 % with 6 coys forward and 2 coys behind; reserve 4–6 h) and Fig 7
  (p 26) strike corps attack (frontage 100 km; two bridgeheads, a RAPID and an infantry division, about 12 km each;
  armoured division and logistics 50–60 km back for a break-out on D−1). These readings of the figures must be confirmed
  by the user before use. More templates from KYE 2019 (`Material/Literature/1. Books/KYE/`) after it is read.
- **Situation template** (p 22–23): lay a doctrinal template along an enemy AA (oriented and scaled to its frontage).
  The Ground Guide then judges every template symbol for its own profile and lists the absurdities ("tanks in swamps,
  artillery on hilltops", p 23) with the nearest usable ground. The planner adjusts. Symbols marked known or confirmed
  are never moved (p 23). Enemy objectives, immediate and subsequent above Bn level, are proposed from own dispositions
  and key ground.
- **Event template** (p 23–28): NAIs on each enemy AA where critical events are expected (crossings, chokepoints,
  junctions, LZ / DZ, likely assembly areas; FM 34-130 App B adds linear NAIs across AAs and NAIs where AAs or MCs meet),
  each with its earliest and latest time (H+ / D+) from the enemy's start at the book's rates. An event matrix in Copy as
  Text.
- **Decision support template** (p 28–32): TAIs are NAIs where interdiction would make the enemy abandon the COA or need
  unusual engineer support: a bridge with no bypass (detour on the network), a chokepoint narrower than the AA's MC
  width, the only ford, DZ / LZ, assembly areas (p 28). Each **decision point** goes on the AA where the enemy is at
  least **2 h** short of its TAI (p 30; `ipb.dpLeadH`), or longer if the own action takes longer (`ipb.reactionH`, user).
  Numbered stars with their D+ times, as in Fig 10 (p 31).

### 6.8 Create on Map

Each product can be written to the map as ordinary symbols, grouped into overlays named as in the old system: **COO**,
**Own AAs**, **En AAs**, **Obsn & Fire**, **Air**, **Event**, **DST**. They save with the plan, export to GeoJSON and
PowerPoint, and can be edited like any symbol. Symbol keys are in §4.

---

## 7. Data and settings

- **`MS/Data/IpbDoctrine.json`**: the book's figures (basis D, cite = printed page), the ATP / FM 34-130 figures (basis D
  with their own cite), proposals (basis E): the ±45° MC direction, the roads-per-km reading, the mover mapping, the
  proforma sign rule, the Div frame size where no source gives it. Same basis codes and handling note as
  `OcokaDoctrine.json`.
- **Settings `groundGuide.extended.ipb.*`** (the Extended View itself stays unsaved: F starts off): product switches; `avlbSpanM: 18` (T); `dpLeadH: 2` (D, p 30); `reactionH`; the two
  proforma group names and sides; flight height and LZ size once sourced. A Ctrl+K group *IPB*, the ⚙ widget and the
  API Test panel entries (CLAUDE.md note 5).
- **Terrain bundle optional:** IPB reads the bundle only through the Ground Guide's existing readers and loads nothing
  while the guide or the product is off; without the bundle it says so and draws nothing that needs the ground.
- **API** (proposal): `guide.ipbReading()`, `guide.ipbText()`, `guide.createIpbOverlay(kind)`, event
  `ground-guide-ipb`.

---

## 8. Phases

Each phase ends usable, with Node checks in `tools/ipb-test/run.mjs` (synthetic cases with known answers, then real
sites).

1. **Pages agreed and the doctrine data.** The user picks from `ground-guide-ipb-options.html` (tab layout, Apch style,
   overlay paint, DST picture, proforma style); `IpbDoctrine.json`; the §6.1 coding as a pure module with reasons and the
   *not assessed* list, run only while F is on; the Extended View overlay can paint it. Done when every criterion has a
   synthetic check and a real area shows the coding with reasons.
   **Built 2026-11-14** (picks: layout A, attack arrows, Trace hatch, Minimal preset, labels Auto, time ladder, proforma
   matrix): `MS/Data/IpbDoctrine.json`, `GroundGuideIpb.ts` (pure), `GroundGuideIpbMap.ts`, `extended.overlay: ipb` +
   `extended.ipb.*`, `guide.ipbCodingAround()` / `ipbReasonAt()`, 40 checks; see *IPB coding* in `15-ground-guide.md`.
   Left for later: man-made obstacles read from map symbols (the module already takes `obstacles`).
2. **MCs and AAs.** The §6.2 engine (pure, in the tile worker, cached per area), the Div frame, own and enemy AAs,
   crossover corridors; tab 3 replaces Approaches (the old single path kept as a switch); the rail's line 3 and the map.
   Validated on Demo 2 (§9).
   **Built 2026-11-14**: `GroundGuideIpbCorridors.ts` (pure; least-cost ways from strips, two corridors side by side =
   an avenue, narrows, crossovers), `GroundGuideIpbApchMap.ts`, `GroundGuideIpbApchView.ts`, `extended.ipb.{apchs, hq,
   mapCorridors, labels}`, `IpbDoctrine.json corridors.{hqRows, frames, method}`, `guide.ipbApproaches()` /
   `ipbApproachesAround()`, `tools/ipb-test/corridors.mjs` (22 checks). Differs from the plan: worked out on the main
   thread once per area (0.2 to 0.6 s), not yet in the tile worker; the rail draws the avenues at the spot's scale, it does
   not widen to the area. Demo 2: partial agreement (see *IPB avenues* in `15-ground-guide.md`).
3. **Create on Map** for the coding, MCs and AAs.
   **Built 2026-11-14**: tab 3's Create on Map tile and `guide.createIpbOverlay(kind)`: No Go / Slow Go areas traced from
   the coding (`GroundGuideIpbShapes.ts`), Mob Corridors lines with the corridor echelon, Main Attk / Sp Attk (or Avenue
   of Apchs, `ipb.createAs`); one undo step, a new set replaces the last; `tools/ipb-test/shapes.mjs` (11 checks).
   Differs from §6.8: PAMS8 saves overlays per layer, so the overlay names (COO, En AAs) are not kept; narrows and
   crossovers are not written (no symbol).
4. **Observation and fire corridors and the Proforma** (tab 1 page 1, tab 3 proforma, rail line 1, Copy as Text).
   **Built 2026-11-14**: `GroundGuideIpbFire.ts` (fans from the other side's Posns on the map, coverage along each avenue,
   gaps, surveillance, killing area candidates), `GroundGuideIpbProforma.ts` (rows a-l, h split, two groups: this side and
   the other side over the same area, median suggestions, user signs), tab 1 tiles, tab 3 proforma, map colouring and
   ranges, rail line 1, Copy as Text; `extended.ipb.{fire, mapFire, proforma, pfHead1, pfHead2}`; `tools/ipb-test/fire.mjs`
   (18 checks). Not done: Wx for Fire (Annex A, Phase 5); fans from ITG candidates and lines of defence as likely Posns;
   re-lettering avenues by the proforma totals (letters stay by the going). Also fixed: arrow heads in proportion
   (`arrowHeadFrac`), not a fixed 15 % of the length.
5. **Rates, Annex A, event and decision support** (tab 5, rail line 5, the Wx tiles, Create on Map).
   **Built 2026-11-14**: `GroundGuideIpbDecision.ts` (`decide`: times at the book's rates earliest / latest, NAIs, TAIs,
   DPs 2 h before each TAI + reaction, counter-attack DP before the depth localities, DPs beyond the area or before H;
   `annexA`), tab 5 Decision (key 5), Wx for Fire (tab 1) and Wx for Mnvr (tab 3), map NAIs / TAIs / DP stars, rail line 5,
   Create on Map NAI / TAI / Decision Pt, Copy as Text; `extended.ipb.{decision, mapDecision, reactionH, hHour}`;
   `tools/ipb-test/decision.mjs` (23 checks). Not done: page 2 (situation template check, template phases: Phase 7);
   COA 1 / COA 2 split (most likely / most dangerous: the commander's, the proforma's lead is shown); linear NAIs across
   the avenues; foot rates by terrain (IBB p 18, Mountain p 81) beside the book's.
6. **Air:** tab 4, rail line 4, after the flight heights and LZ sizes are sourced.
   **Built 2026-11-14**: figures sourced (FM 3-04.203 flight bands, FM 3-21.38 landing points / slope / 10 : 1, DAFMAN
   13-217 DZ, open MANPADS reach: basis T, to confirm with Army Aviation and AD; MW p 256 helipads 4°, OoW Vol I pp 61-63
   heliborne use and OPs: D) into `IpbDoctrine.json air`; `GroundGuideIpbAir.ts` (pure: least-cost air avenues on a 150 m
   grid, LZ / DZ squares, OPs over the enemy's LZs, AD sites with long-range / flank / bottom shots, flight profiles),
   tab 4 `GroundGuideIpbAirView.ts` (picture, flight profile, ranked avenues, LZ, DZ, AD sites, Wx for Air, Read As, Create
   on Map), map, rail line 4 (`XH`), Copy as Text, `guide.ipbAir()`, `createIpbOverlay('air')` (LLTR, LZ, DZ, SHORAD EZ, OP);
   `extended.ipb.{air, mapAir, airBand, lzClass, lzPoints}`; `tools/ipb-test/air.mjs` (29 checks). Differs from §6.4: no
   restricted air space read from the map yet (ROZ, gun-target lines); AD sites are scored for the defender's side of the
   area, not limited to `ad` GO ground; concealment is a chance (sight with crops, trees and buildings), the OP and AD lines
   of sight treat trees and buildings as solid (neither overstated); with no room for all the landing points, single points
   are shown.
7. **Templates:** after KYE is read and the user has confirmed the Fig 6 and Fig 7 readings.
   **Built 2026-11-14** (the user asked for all phases in one go; the Fig 6 / 7 readings are kept but marked unconfirmed):
   KYE-2019 read (password from the PW file name, nothing written to disk; Indian military thinking pp 68-74, Armd Div pp
   91-92, Inf / Mtn Div / RAPID pp 216-218, logistics pp 307-309, BSF p 361, mobilisation pp 342-343) into
   `MS/Data/IpbTemplates.json` (six templates, template phases, figures with pages, handling note); `GroundGuideIpbTemplate.ts`
   (pure: placement along the avenues, judging per mover on the IPB codings, nearest usable ground, known symbols kept),
   tab 5 page 2 `GroundGuideIpbTemplateView.ts` (picture, check, phases, library, Create on Map), map, rail row, Copy as Text,
   `createIpbOverlay('template')`, `extended.ipb.{template, mapTemplate}`; `tools/ipb-test/template.mjs` (27 checks).
   Differs from the plan: the situation template is checked on the IPB codings (one per mover, worked out once per area), not
   per element against GROTBC; no Fig 8 (cut off in the PDF); element distances not in the sources are my placements (E).

Each phase checks the cost rule: nothing runs with F off (a test turns F off mid-reading and checks that the caches and
map layer are empty).

Docs: a new section in `15-ground-guide.md` per phase; a line in `CLAUDE.md` under GroundGuide.

---

## 9. Validation

- **Demo 2 "1-IPB"** (`Material/plans/overlays/ipb.json`, Div level, 36 symbols: 20 NO-GO areas, 3 SLOW-GO areas,
  3 corridor lines, 4 decision points labelled 1, 1, 3 and 4, 5 filled freehand areas, 1 text): overlap of our NO-GO /
  SLOW-GO with theirs; whether our MCs fall in their corridors; our DPs against theirs.
- **Demo 2 "4-En Cap"** (`en-cap.json`): its 10 enemy avenues against our enemy AAs.
- **Phillora** (Vs72's ground), where the AOR scale was checked.

---

## 10. Data gaps and possible pipeline additions

| Gap | Effect | Candidate (to choose under the data-source rule: latest + coarser variant, dated) |
|---|---|---|
| Water table depth | Water-table criterion not assessed | A modelled groundwater-depth grid, or WAPDA / PCRWR depth-to-water maps for the Indus plains |
| Tree trunk and spacing | Vegetation criterion not assessed | None known; forest / orchard classes only |
| River width, depth, current, bank | Hydrology assessed only where recorded | More sheet attributes; recce |
| Ceiling, cloud, rain rate, humidity | Annex A rows not assessed | NOAA ISD hourly (same licence limits as GSOD) |
| Snow depth | Annex A snow rows not assessed | Reanalysis snow depth (e.g. ERA5-Land) |
| DCB, AT ditches | Man-made obstacles only from symbols | User draws them |

---

## 11. Open items

1. Downhill slopes of 30° or more: confirm the *not classed by the book* mark.
2. Relief over 400 m per km: not classed by the book.
3. Hydrology: the book says velocity > 5 ft/s **and** depth > 4 ft; FM 34-130 B-6 lists them separately. Built as
   written unless the user decides otherwise.
4. "Roads per kilometer": read as road length per km in a 1 km window (E).
5. Mover mapping armoured / mechanized / dismounted ↔ profiles (E).
6. Bn HQ: no Coy AA / Pl MC row in the book or ATP.
7. Flight heights and LZ sizes for Pakistani aircraft: US public figures used (T, Phase 6); confirm with Army Aviation.
8. AVLB span: confirm with engineers (default 18 m, T).
9. Fig 6 and Fig 7 readings: to confirm; Fig 8 is missing from the PDF.
10. Div frame size: from a source if one exists, else E.

---

## 12. Sources

- *Intelligence Preparation of the Battle Field (IPB)*, Command and Staff College Quetta, RESTRICTED (local PDF, p 1–32).
- ATP 2-01.3 *Intelligence Preparation of the Battlefield*, March 2019, C1 6 January 2021, Table 4-2 and paras 4-21
  to 4-27, p 4-8 to 4-9: <https://irp.fas.org/doddir/army/atp2-01-3.pdf>
- FM 34-130 *Intelligence Preparation of the Battlefield* (1994), Appendix B figures B-6, B-13, B-17, B-18:
  <https://www.globalsecurity.org/intell/library/policy/army/fm/34-130/figb-3m.htm>
- Pakistan Army (restricted, locked PDFs in `Material/Literature/1. Books`, read 14 Nov 2026, rules kept in memory only):
  *Infantry Battalion in Battle* (AP 8360 E, `Material/IBB.pdf`); *Desert Warfare* (GSP-1972, 2002); *Mountain Warfare*
  (GSP-1973, 2003); *Operations of War Vol I Defence* (AP 2302 E, 2015); *Operations of War Vol II Offensive Operations*
  (AP 2303 E, 2015; Forms of Manoeuvre s6 pp 19–21, Forms of Attack pp 22–28).
- M60 AVLB: <https://en.wikipedia.org/wiki/M60_AVLB>; Pakistani equipment lists (unconfirmed):
  <https://www.wikiwand.com/en/articles/List_of_equipment_of_the_Pakistan_Army>,
  <https://military-history.fandom.com/wiki/Equipment_of_the_Pakistan_Army>
