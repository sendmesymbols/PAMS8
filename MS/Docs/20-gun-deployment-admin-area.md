# 20 · Gun Deployment and Admin Area

Two site finders, built 17 Nov 2026. Each is its own engine, off by default, with a top-bar button, a Ctrl+K settings
widget and a panel docked at the foot of the map. Both read the terrain bundle only while switched on
(`claude_rules.md`). Without the bundle the panel says "Needs terrain data" and nothing else changes.

| | Gun Deployment | Admin Area |
|---|---|---|
| Button | 🎯 Gun Depl (+ ⚙) | 🏕 Admin Area (+ ⚙) |
| Switch | `features.gunDeployment` | `features.adminArea` |
| Settings | `gunDeployment.*` | `adminArea.*` |
| Panel | bottom left | bottom right |
| Map layer | `ms-gun-deployment` | `ms-admin-area` |
| Pure engine | `GunDeployment/GunDeploymentFind.ts` | `AdminArea/AdminAreaFind.ts` |
| Figures | `MS/Data/GunDoctrine.json` | `MS/Data/AdminDoctrine.json` |
| API | `symbolEngine.gunDeployment` | `symbolEngine.adminArea` |

Shared pieces live in `MS/Engines/SiteScan/`:
- `SiteScan.ts` is the pure ground reader.
- `SiteProbe.ts` is the bundle reader. Each finder gets its own instance of the Movement Guide's probe, plus the climate grid and the OCOKA surface blockers.
- `SitePanel.ts` is the panel.
- `SiteMap.ts` is the map layer.

`node tools/sitefinder-test/run.mjs` runs 52 checks on a synthetic ground.

## How to use

1. Click the button. It turns the feature on and opens the panel.
2. **Pick** (or click the map after **Pick gun area / Pick area**) where to look roughly. This is the centre of the search circle.
3. **Target** (gun) or **Threat** (admin). Each defaults to the Ground Guide's threat marker when one is set as a place. You can also pick it on the map, or (gun only) use the selected symbol.
4. **Front** is read off the map: the FEBA / FDL (2525D 25 140400) and FLOT (25 140100) lines you have drawn. If there are none, the threat place is used.
5. The finder ranks the sites. Click a row to see its checks. Each check shows a value, a colour, the reason, and a fix when it fails.
6. **Create on Map** makes the selected site an ordinary symbol, with one undo step:
   - a PAA (circular, 25 240502) for a gun area;
   - a 2525D support area or a catalog point for an admin site.
7. **Copy as Text** gives the list with grid references.

Settings in the strip:
- **Gun Deployment:** gun (own artillery from the ORBAT `weapons.json`), Bty / Regt, Def / Attk, search radius, month.
- **Admin Area:** kind, operation, month, the enemy gun to stay clear of, where his guns stand behind the threat place, vehicles (sizes the area), search radius.

## What a site is checked on

**Gun area** (Bty 400 x 200 m, Regt 1000 x 1000 m, frontage across the line of fire):

- **Room:** share the guns can stand on (rules.json profile `gun`).
- **Level:** a plane fitted to the 30 m elevations. 5° ok, 10° most.
- **Firm:** the month's cone index. Towed guns are judged as heavy wheels, SP guns as tracks.
- **Hidden from air:** concealment from the air (cc) and tree cover.
- **Access:** nearest road, its load class, and whether it is all-weather.
- **Range:** the target against the planning range (90 % of max) and the minimum range.
- **Behind front:** at least 2 km behind (proposal). At most 1/3 of the planning range behind, so that 2/3 of the range reaches forward.
- **Crest:** toward the target, using ground plus what stands on it (trees, crops, buildings) and the earth's curve, rules per FM 6-50 ch 6:
  - A1 (angle of site to the crest) and A2 (5 m clearance over the PCR), each rounded up to the next mil.
  - A4 (elevation at the PCR) is an **estimate**. It uses a vacuum curve fitted to the gun's maximum range.
  - A3 (comp site) and A5 (2 forks) need the firing tables and are named, not computed.
  - The same curve gives the nearest range at which low-angle fire clears the crest.
  - A howitzer that is masked gets a warning to fire high angle. A gun that is masked fails.
  - Over 300 mils A1 + A2: work the minimum QE out by hand.
- **Avoid:** BUA on the site; bridges, junctions, stations, masts or forts within 500 m.

**Admin site:**

| Kind | Size | Clear of his |
|---|---|---|
| Unit Ech | 400 x 400 m | field guns (MIB p 66) |
| BAA | 2.5 x 2.5 km (decision) | medium guns (ATP 4-90 p 27) |
| DAA | 4 x 4.5 km | medium guns (decision) |
| RP | 2 x 2 km | medium guns (decision) |
| AP | 1 x 1 km (decision) | medium guns (decision) |
| ADS | 300 x 300 m (decision) | field guns (Glossary p 9) |

Each site is checked on:
- **Beyond en guns:** distance from the threat place against the gun's range, less his gun depth (0 by default, the safe side).
- **Behind front (DAA):** Def 48 km, Adv 15–20 km, Wdr about 33 km.
- **Firm:** wheels.
- **Flood / drainage:** fails in a wet month.
- **Room.**
- **Hidden from air.**
- **Road:** class 50, within 1 km, all-weather, and the area off the main road.
- **Avoid:** bridges and junctions within 500 m, BUA.
- **Water and Pucca bldg:** DAA, ADS and Ech.
- **Evac Rd:** ADS.
- **People.**

A wet month is one with 100 mm of rain or more at the place (WorldClim, climate.json). Without the climate grid, Jul–Sep count as wet.

## Doctrine and decisions

Each figure carries a basis code:
- **R:** a Pakistani book, with its page.
- **U:** US doctrine, where the Pakistani books are silent.
- **E:** a proposal for the user to correct.

Sources:
- **Guns:** SO's Handbook 2019 Sec 2 (pp 202–227); SZ Battle handout p 24; FM 6-50 (1996: paras 2-13, 2-14, 3-6, ch 6, p 7-3, App F); JMRC / army.mil 2024 (slope).
- **Admin:** SO's Handbook Sec 10 (pp 1023, 1053–1062) and Sec 13 (p 1325); LSF (pp 24–29, 47–49); GSP Inf Div in Battle (pp 181–185, Anx D); MIB (pp 9, 66–67, 188); FM 4-90 (p 3-5, B-1).
- **Not read:** the New Logistic System CSC handout (needs its password). ATP 3-09.50 could not be retrieved, so the U gun figures rest on FM 6-50, which it replaced.

Not in the Pakistani books (so marked E):
- Bty frontage and depth, gun spacing, the slope limits, the crest-clearance method (all from US doctrine).
- The minimum distance of guns behind the FDL; alternate positions 500 m apart.
- BAA size and distance; the road class for admin areas.
- The area sizes for AP and ADS.
- Which enemy gun each kind must clear, except the harbour rule (MIB p 66, R).
- The shares that turn a check from warn to fail.

My decisions (tell the user if asked):
- **Unit Ech symbol:** made as 2525D Regimental Support Area (25 310500). 2525D has no echelon area.
- **RP and AP:** use the catalog's Ammunition Point (25321711).
- **ADS:** uses the catalog's UEI Army Medical Corps / ADS (10110214).
- **New symbols:** RSA / BSA / DSA added to Symbols.json and Mapper on `____LabelledAreaBase`, with the 2525D word inside. Create on Map writes no designation on them, because the centred designation label sat on the word.
- **Enemy guns:** classed from weapons.json. 75/76/105/122 mm are field; 130/155 mm and the 7.2 in are medium (the 7.2 in is really heavy, but is treated as medium so it is checked). Mortars and MBRLs are their own classes. Medium defaults to the 130 mm M-46 (27.49 km), field to the 105 mm IFG (17.2 km). The panel can pick any enemy weapon (Bofors, Bhim, BM-21…).
- **Failing sites:** an admin site within his reach is still listed when it is among the best, as a fail with the distance to move back. Places under 80 % of his reach are not tried.
- **Lattice step:** 150 m for guns, so a 4 km search takes about 0.2 s on the main thread. For admin sites the step is a third of the area's side.

## Not done / open

- The minimum QE is an estimate until firing tables (Tables F and G) are in the data.
- The crest walk uses the GLO-30 surface model (30 m). A crest narrower than a cell, or a single building, can be missed. Confirm on the ground.
- Gun Deployment places one area per search (Bty or Regt). It does not split a Regt into three Bty positions.
- Admin Area does not check the 64 km RP-to-DAA limit, the IN / OUT circuits, or the clearance from transit and assembly areas.
- Verified in the app (17 Nov 2026, Sialkot sector):
  - both buttons; the panels; a real map pick;
  - Gun Depl giving 6 Bty areas with crest, range and access rows, and Create on Map making a PAA;
  - Admin Area giving 5 BAA sites clear of the M-46, and Create on Map making a BSA.
- Not verified: 3D, narrow screens, the settings gears, a drawn FDL on a real map (covered by the Node checks only).

## Justifying a choice: rule, book and page (17 Nov 2026)

The user asked for this: "people will not believe me … until we give them rule and book and page #". Every decision both
finders make now carries the rule behind it.

- **Every figure has its reference.** In `GunDoctrine.json` and `AdminDoctrine.json`, a figure has `refs`: the book (a
  source id with a short name and the PDF under `Material/`), the printed page, the words, and a role:
  - `rule`: the figure comes from these words.
  - `context`: the figure is a proposal (E), and these are the book's words it rests on.

  A proposal with no book rule says so, with the reason.
- **Every reference is checked against the book.** `python tools/doctrine-refs/verify.py` turns each PDF into text with
  `pdftotext` and looks for the words on the cited page. The page number is read from the page header; for the SOH,
  where reading order drops the header, it is read in layout mode. `--write` records the result in each reference as
  `checked`.
  - Online-only sources (FM 6-50, FM 3-09.21) were checked from the copies fetched on 17 Nov 2026, using
    `--text fm650=… --text fm30921=…`.
  - The army.mil JMRC article and FM 4-90 are not checked locally and say "online".
  - A run without the online texts keeps the earlier result.
  - On 17 Nov 2026 every reference was found. SO's Hbk p 212 was confirmed in layout mode.
  - Password-protected PDFs open with the digits of the `PW - <digits>.txt` file in the books folder. Nothing is sent
    anywhere.
- **Every check row cites its rules.** Each row (Room, Level, Firm, Range, Behind front, Crest…) has `rules`. The panel
  shows them folded under the row as "📖 SOH Sec 2 p 212 · FM 6-50 p 3-6 · proposal". Open it to see each rule with its
  words and a ✓ when the words were found on that page. Badges: R Pakistani book, U US doctrine, E proposal, T the terrain
  data's own rule (rules.json), D the ORBAT (weapons.json, read from the handbook page shown).
- **Why the list is in this order (`site.why`).**
  - #1 says why it was chosen, and why it beats #2.
  - Every other site says which checks put it below the one above, with both values.
  - When two sites tie on every check, it says so and names the small differences in the finer reading. Treat them as
    equal choices.
- **Places left out (`rejectedWhy`).** Each reason (NO-GO at the centre, out of range, on the target's side of the FDL,
  too near the front, no room, within the enemy gun's reach, wet ground) comes with its count, an example and its
  rules.
- **Why not here?** A button: click any place.
  - It is read with the same gates and checks as the search (one shared scorer: `gunScorer` / `adminScorer`).
  - The panel lists the gates it fails with their rules, the checks where #1 is better, and every check at that place.
  - It is drawn on the map as "Why not?". API: `gunDeployment.setWhyNot([lng, lat], { lngLat: true })`,
    `whyNotReading`; the same on `adminArea`.
- **The decision record (Copy as Text).**
  - Every site with its "Why" lines and its checks, each followed by numbered citations [n].
  - The places left out and the "Why not here?".
  - At the end, **Rules cited**: [n] basis, figure, book, page, words, "(checked in the book)".

Tests: `tools/sitefinder-test/run.mjs` (67) checks these:
- every row has rules;
- Range cites SOH p 212, checked;
- Behind front cites SZ p 24 and marks the 2 km minimum as E;
- Unit Ech cites MIB p 66, and the DAA cites SOH Sec 10 p 1055;
- the order explanations;
- "Why not here?" gates with rules;
- the decision record.

## Everything backed: data, inputs and every threshold (17 Nov 2026)

The user: "whatever it is triggering, if it not book its some data related, mention it. everything should be backed".
Every check now cites four kinds of backing:

- **The rule (threshold).** It comes from a book (R / U, page checked) or a proposal (E). A proposal is marked as such, with
  its reason, and is never shown as doctrine. **No number is hidden in code any more.** The working thresholds are named
  figures in the doctrine files:
  - **`checks`:**
    - a site is "not read" under 60 % known data;
    - soft ground needs work over 10 %, with marginal soil counted x0.5;
    - a road over 2 x the limit fails;
    - the crest is not read over 30 % unknown;
    - people need work over 1,500 per km² (17 Nov: the UN Degree of Urbanisation's "dense", p 52);
    - what counts as a main road.
  - **`scan` shortcuts:**
    - 80 % of his gun's reach;
    - 1.5 x the NO-GO limit, 3 x the waterlogged limit;
    - half the minimum distance from the front;
    - the gates apply where half the data is known;
    - the lattice step and how many places are read.
  - **`order`:** the list's method, the score per verdict, the weights and the finer reading.
- **The data the value was read from.** Each row names the bundle layer and the sources it was built from, with their dates
  and restricted flags, from the bundle manifest (`SiteScan.dataCatalog`). For example, Hidden from air reads the
  cover / concealment layer: ESA WorldCover 2021; JRC Global Surface Water 1984-2021; Copernicus GLO-30 2011-2015;
  OpenStreetMap 2026-10-28; 1:50k map [restricted]. The others:
  - **Heights:** GLO-30.
  - **Soil:** SoilGrids 2.0 (2020) + 1:50k map.
  - **Roads:** the road network (OSM 2026-08-27, HeiGIT, 1:50k map).
  - **Places, water and buildings:** the feature tiles.
  - **People:** WorldPop 2026.
  - **Month's rain:** WorldClim 1970-2000.

  The 1:50k map is never named NCGDB.
- **The terrain data's own rules (T).** These are the NO-GO class lists (rules.json profile, version 2026.11-grotbc-v2),
  the soil rule, and the climate grid's wet threshold:
  - The soil rule's *method* is US practice (WES / NRMM cone index), and its *vehicle figures* are marked in rules.yaml as
    a STARTING PROPOSAL. Both are shown.
  - The climate threshold is 100 mm in the month (climate.json).
- **Your inputs.** Where the target, front, threat and enemy gun came from: picked on the map, the FDL drawn (FEBA / FLOT
  symbols), the Ground Guide threat marker, chosen in the panel or the kind's default.

**Where it shows:**
- In the panel, the folded rule line under each row lists all four kinds; the data entries are marked "data".
- "Why #1 is here" carries the ordering method.
- The decision record lists every citation as [n], with [data] lines, and has an "Order:" line.

The same applies to the three terrain tools:
- **Compare:** every row's "how" now names its data, where the alternatives came from, and the difference below which it
  does not rank (proposal).
- **X-Section:** "What this rests on" lists the line, the data with dates, the terrain rules and its working thresholds
  (30 m samples, 250 m crossing, 3 m climb step, 60 m slope base, 0.5 sight chance).
- **AOI Check:** "How it is judged" lists the data it reads and its thresholds (gaps under 0.5 % not counted, bad from a
  50 % core gap).

**Tests:** `run.mjs` (77) checks, with the real manifest, that every gun and admin row names its data, the cc sources and
dates, the soil rule's STARTING PROPOSAL note, your inputs, the x2 and 1,000 figures, and the order. `tools.mjs` (43) checks
Compare's thresholds and data, and how source dates are read.

## Searched and decided (17 Nov 2026)

The user: "search for it, books or internet, make sensible decisions on my behalf for this session and get it done".
Every proposal was looked for:
- **Pakistani books:** all of Material/Literature, through pdftotext.
- **Open doctrine.** The copies are kept in `Material/Literature/2. Online/`, which is git-ignored, each with its .txt:
  - **Artillery:** ATP 3-09.50, ATP 3-09.70, FM 3-09.70, FM 3-09 (2024), TC 3-09.81, FM 6-50, FM 3-09.21, FM 20-3.
  - **Logistics and medical:** ATP 4-90 (2026), ATP 3-21.20, ATP 3-90.5, FM 3-96, FM 3-90, ATP 3-91, ATP 4-35, ATP 4-44,
    ATP 3-34.81, FM 63-2, FM 63-20, FM 63-21, FM 71-123, FM 8-10-4, FM 4-02.4, FM 4-90 (2010), FM 100-2-1.
  - **Civil standards:** the UN Degree of Urbanisation manual (2021); Esri's viewshed help.

Each figure now carries one of five kinds of backing:
- **A book rule:**
  - **R:** Pakistani book.
  - **U:** US doctrine.
  - **S:** published civil standard.

  Each gives the page and the words, checked by `verify.py`, which also reads saved web pages (`file` ending .txt).
  Where the value is worked out from book figures, a `calc` field shows the working.
- **M, a method setting:** how the finder searches, reads or orders. It is not a military rule. The search shortcuts are
  proved by tests: every place a shortcut cuts fails that check when read in full.
- **E, a decision:** no book gives the figure. It carries:
  - `decided: 2026-11-17`;
  - `searched`, the books and manuals it was looked for in;
  - the reason, with the book words it rests on as context.

  The panel shows it as "Decision, no book figure", followed by "Looked for in: ...".

**Values changed by the search:**

| Figure | Was | Now | Backing |
| --- | --- | --- | --- |
| Gun, alternate posn | 500 m (E) | 500 m (U) | ATP 3-09.50 p 2-2: survivability moves of 300-500 m |
| Gun, attack: behind own fwd tps | 1.5 km (E) | 1 km (U) | FM 3-09.70 p 3-3: 1 to 8 km behind the forward manoeuvre units |
| Gun, crest refraction | 0.13 (E) | 0.13 (M) | Esri: the Gaussian coefficient (Brunner 1984) |
| Admin, ADS clear of en | mortar (E) | field (R) | Glossary p 9: not within the range of enemy field artillery |
| Admin, BAA clear of en | medium (E) | medium (U) | ATP 4-90 p 27; ATP 3-21.20 p H-20 |
| Admin, BAA size | 3 x 3 km (E) | 2.5 x 2.5 km (E) | worked from FM 63-2 p A-4 (BSA : DSA) and the DAA (SOH p 1054); under a whole Inf Bde's 8-10 map sq (SOH p 1065) |
| Admin, AP size | 500 m (E) | 1 x 1 km (E) | on wheels (LSF p 25), sized by vehicles (LSF p 26) at 50 per km² (SOH p 1054) |
| Admin, AP clear of en | field (E) | medium (E) | not an obvious arty target (MIB p 111); US ATHP beside the BSA (ATP 4-35 p 4-9) |
| Admin, off the main Rd | 150 m (E) | 1 km (U) | FM 63-21 p 1-4: not astride the MSR, 1 to 3 km from it |
| Admin, people | 1,000 / km² (E) | 1,500 / km² (S) | Degree of Urbanisation p 52: "dense" |
| Admin, landmark distance | 500 m ("U") | 500 m (E) | mislabelled before: the US words were context only |

**Counts now:**

| | R | U | S | M | E (decided) | Total |
| --- | --- | --- | --- | --- | --- | --- |
| GunDoctrine | 7 | 10 | 0 | 11 | 12 | 40 |
| AdminDoctrine | 14 | 2 | 1 | 9 | 31 | 57 |

**Notes on the decisions:**
- **His gun depth stays 0.** The only figures are a Soviet template (1-4 km, FM 100-2-1 p 5-22) and a US example. Neither
  is an Indian figure, so the default stays the safe one until you set it.
- **The DAA stays "clear of medium".** In the advance (15-20 km, SOH p 1055) its Beyond row fails and says so.
- **One part of the crest reading is not backed yet.** What stands on the crest (trees, crops, buildings) comes from the
  Ground Guide's `OcokaDoctrine.json` (`surfaceBlockers`, `cropCalendar`), still proposals there.

**Tests (`run.mjs`, 88):**
- every figure is backed;
- no E is left undecided;
- every reference was found on its page;
- the changed values;
- the decision label;
- the shortcut proofs.
