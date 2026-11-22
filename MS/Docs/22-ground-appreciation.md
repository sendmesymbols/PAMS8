# 22. Aprc: the appreciation drafted from the map

`MS/Engines/GroundAppreciation/` · off by default (`features.groundAppreciation`) · top bar **📝 Aprc** with ⚙ ·
Ctrl+K → *Aprc (Appreciation)* · built 22 Nov 2026 · plan `Appreciation_Plan.md` · mockup
`ground-appreciation-export-options.html`.

The appreciation of the situation is the planner's own document. This engine drafts what the ground and the map can
tell, leaves the rest as ruled lines for him, and writes the whole out as a Word document, a PDF, text and slides.

## What it reads

Nothing is read until **Read** is pressed.

| From | Through | Gives |
| --- | --- | --- |
| The ground | `GroundGuide.aorAround()` (the Gr Scope AOR reading, the rail need not be open), `sectionsAround`, `coverAround`, `extendedAround` at the MITG and at one point on each approach | Gr and Weather: Gen Description, Apchs (twelve heads each), ITGs, Obs, Cover, Met Conditions, Deductions; the DP 1 tasks table and what it needs (Assessment of Tasks, Basic Deductions) |
| The IPB reading | `GroundGuide.ipbApproachesAround(mitg, { readFor: 'defence', extras: true })`: the en's avenues onto the position with the decision support (his time along each at the book's rates, TAIs, DPs), the Annex A weather and the doctrinal template (F need not be on) | Options Aval to the En (Option 1 and 2 with places, times, template phase names, advs / disadvs; Most Dangerous when the two differ by 15 min or more), En Reactions and Own Ctr Actions (TAIs against DPs), the Annex A values in Met Conditions |
| Symbols on the map | `SerializationEngine.planRecordsOf()` → `PlanCheck.readSymbols` | En Forces, En Composn and Disposn, Own Forces, Composn, Disposns, the relative strength table (counted by echelon), obstacle symbols in Obs |
| A checked plan | the Intelligent Deployment tab's last Check my plan (`DeploymentBuilderEngine.planCheck`) | Own Disposns, Course A, advs / disadvs, en reactions against own moves (replacing the IPB table), the general outline |
| The ORBAT | `groundAppreciation.orbatUrl` (default `/MS/Data/Orbat/PK`, as the Intelligent Deployment tab reads it), `PlanOrbat.brief`, `PlanEngr.ownEngrTypes` / `minesByEngr` | Own Str as Related to that of the En (manoeuvre Coys, all ranks, ATGM, mortars, ratio en to own), Composn of Own Forces, the Pls held against DP 1 and the ATGM pairs, the protective minefield's hours in Time Req |
| Doctrine files | `PlanDoctrine.json` (`readyBy.coyPosnH`: IC s75 p 399; `enemy.defaultUp` / `defaultType`), `MoveDoctrine.json` (`road.speeds`: SO's Hbk Sec 9 / SD Vol II) | Improvement of def posns, the move in, the en assumed when none is marked |

The MITG is a VG symbol, else the selected symbol, else the map centre. The AOR is the Bdy symbols, a drawn box or the
echelon frame, as the Gr Scope AOR setting says (`groundGuide.aor.source`).

**Terrain bundle.** The engine reads the bundle only through the Ground Guide. With the guide off or no bundle, the
sheet still opens, takes the planner's words and exports; the Gr paragraphs stay ruled and the sheet says why, with a
button to turn the guide on.

## The sheet

Redesigned 22 Nov 2026 (the impeccable design pass): one workflow, Read → settle each paragraph → export.

- **Header**: the kind, what the reading was taken with (echelon, place, mover, month, when), **Read** / **Read again**
  (a thin bar runs under the header while it reads), **Export** (Word, PDF, Copy as text; Slides in the Briefing - PPTX, one
  item per deck) and **⋯** (Save to a file, Open a file, Clear: asks twice, in the menu, not a dialog).
- **Outline** (left): how many paragraphs are ready for the fair copy and a bar by state; filters **All / To do /
  Proposals / Gr changed / Written** (To do = yours to write + proposals open + Gr changed); *Accept all n proposals*.
  Each top-level paragraph carries the worst state under it as a shape and a word, never colour alone: ✓ written by you,
  ● drafted from Gr, ■ from the map, ◇ proposal open, ◆ proposal accepted, dashed ○ yours to write, red ! Gr changed. Under a
  filter a row goes to the first paragraph it shows.
- **Page** (centre): the page as it prints; *Fair copy* / *Draft copy* and *H on D Day* above it. Click a paragraph to
  select it, double-click to write in it.
- **Inspector** (right): ↑ ↓ and *Next to do*; the paragraph's state with what to do about it (Accept / Take back; Keep
  mine / Use the new reading), the box (*Save as mine*, Ctrl+Enter; what is typed is saved when the planner moves to another
  paragraph, reads, exports or closes, so nothing typed is lost), the table, the sub-paragraphs, To consider, Rests on,
  Confirm on Gr. With nothing selected: the three steps, what the marks mean, the keys.
- **Keys** (in the sheet, never reaching the map): ↑ ↓ (or J K) paragraph, N next to do, A accept, Enter write, Ctrl+Enter
  save, [ ] fold the outline / the paragraph panel, Esc leaves a box, then closes.
- **Folding**: the outline and the paragraph panel each fold to a slim rail (the buttons at the ends of the bar over the
  page, a click on the rail, or `[` / `]`), so the page can take the whole width; the outline rail keeps the to-do count,
  the paragraph rail the selected number. Writing in a paragraph (Enter, double-click) opens the panel again. Which panels
  are folded is kept in this browser only (`pams8.aprc.ui.v1`).
- **Resizing**: drag the edge between a side panel and the page (or focus it and use the arrow keys, Shift for bigger
  steps); double-click or Enter puts the default back. The outline takes 180 to 460 px, the paragraph panel 260 to 640 px,
  and the page always keeps 360 px. Below 940 px the edge above the paragraph panel sets its height. Kept with the folds.
- Scrollbars are thin and dark, in the sheet only.
- **Window**: Minimize, Maximize / Restore down and Close at the right of the header. The Aprc button launches the
  sheet **maximized**: the whole page, edge to edge, as the Briefing's edit view (user, 22 Nov 2026). Restore down (or a
  double-click on the title bar) docks it under the host's bar, and back. Minimized, it folds to a bar at
  the foot of the map with the progress (ready, to do); a click on the bar, its Restore button or the top bar's Aprc
  button brings it back as it was. The bar can be dragged anywhere (a click without moving restores); its place is kept
  in this browser and held inside the window. What was typed is kept, and the keys go back to the map. A read carries on while it is
  minimized. Hosts: `windowState`, `setWindow('normal' | 'max' | 'min')`.
- Messages come as a toast at the foot of the sheet (read out once; a failure stays longer). Below 940 px the outline is a
  drawer (☰ over the page) and the inspector sits under the page.

## The rules of the document

1. **Four states.** A paragraph is drafted from the ground (GR), read from the map (MAP), proposed for judgement
   (YOU JUDGE) or left to the planner (YOURS, a ruled line with the heads to consider).
2. **What the planner writes is his.** *Save as mine* on a paragraph; Read never overwrites it. When the reading under
   it has changed since, the sheet says so and shows the new reading; it does not replace his words.
3. **A proposal is never printed as fact.** Deductions, the list of ITGs, advs and disadvs are proposals. The fair copy
   prints one only once accepted (or rewritten); until then it prints a ruled line.
4. **Nothing is guessed.** What the data cannot tell prints a ruled line. "Ref to whites" is never printed.
5. **Everything drafted says what it rests on**: the data, the inputs, how a figure was worked out. Never the name of
   the 1:50k source layer.
6. **The address block is titles and ruled lines** (copy no, unit, place, Tel Mil, G-, date), filled by hand. **The
   marking is a ruled line too**, at head and foot of every page, to fill or stamp by hand: the engine holds no marking
   text (user, 22 Nov 2026). The slides keep whatever banner the Briefing deck has.

**Tables.** Click a paragraph with a table (relative strength, tasks, time required, reactions) and the right pane shows
it as cells: type into any cell, add rows. What you type is yours (`cells`, `addRows`), kept on a new Read and printed in
every copy; empty a cell, or type the tool's own value, to give it back. A proposed table prints in the fair copy only
its first column and your cells until you accept it.

**Units for the strength.** Own: a built plan's unit (`pbMeta.unit`), else the own symbols of the AOR's echelon taken as
the standard type, else a standard unit of that echelon (both said "assumed"). En: his unit symbols marked (by echelon,
and by name: armour, mech, else inf: `enUnitFor`), else the built plan's en, else one level up (MW p 80), mech (IC s114
p 663; inf in the mountains): said "assumed", and a proposal.

**Time required.** The move in: an own symbol of the AOR's echelon outside the AOR and 2 km or more from the MITG, a
straight line at the night speed of a column of all types on good roads (a lower bound; the road is longer). Posn
preparation 24-36 h. The protective minefield along the FDLs line at the engineer rates (p 439), by the plan's engineers
(`pbMeta.engr`, shared by `engrCoys`) else one Engr Fd Coy, taken and said. The other rows are left for the planner; the
total is a floor.

**His phases.** Where each of his avenues crosses a line of def, his time there from the decision support's profile: the
lines before the FDLs are the prelim ph, the FDLs the break-in (Ph 1), the lines behind it Ph 2, the MITG Ph 3. Unopposed
times: each fight adds to them, and the text says so. **H** (the *H on D Day* box over the page, `groundAppreciation.hHour`,
else the Ground Guide's IPB H) adds clock times: "H+1:14 to H+3:03 (0644 hrs D Day to 0833 hrs D Day)"; changing it
re-times the en paragraphs at once.

**Grouping and Tasks.** From the last Check my plan: a sub-paragraph per fwd, depth and res Coy. "Take up def posn from incl
X to incl Y by ________" (the named places nearest the ends of its posn, left to right as the defender faces), the units
inside its posn as In loc, and for depth and res "Be prep to launch C attk on" the fwd localities and the what-if's moves
("Be prep to occupy C pen 1 on orders (25 min: in time)") as proposals.

**In the plan file.** Save Plan writes the appreciation under `pamsExtras.aprc` (without the pictures) through
`SerializationEngine.registerPlanExtra`; Load Plan puts it back in the sheet. With Aprc off it is held and handed over
when Aprc is turned on, and a save while it is off keeps it.

**What is a proposal here.** The en options, the most dangerous option, the reactions table, the tasks table and what
it needs are proposals (`judge`). The tasks table takes a Coy (3 Pls) to each BUA astride an approach on the FDLs and
in depth, and a Pl each for the Str Pt and the screen: a working assumption to change, not a book figure, and it says so.
Differences under 15 min or 5 % of GO between the avenues are not called better or worse (`WEIGH_MIN`, a method setting).

## Copies and exports

| | Fair copy | Draft copy |
| --- | --- | --- |
| Marks on paragraphs | no | yes |
| Proposal not accepted | ruled line | shown, marked PROPOSAL |
| Heads to consider under a ruled line | no | yes |
| Annexes | the map shot | + Confirm on Gr, basis of each drafted paragraph, data and dates |

- **Word** (`toDocx`, `exportWord`): WordprocessingML written by `AprcDocx.ts`, zipped with the JSZip that the
  PowerPoint bundle already carries. **No new dependency.** A4, Arial 12, the page number and the marking's ruled line
  in the header, the ruled line again in the footer, numbered paragraphs with hanging indents, ruled tables, pictures inline.
- **PDF** (`exportPrint`): the same page through the browser's print (Save as PDF).
- **Text** (`toText`, `copyText`), **file** (`toJSON` / `fromJSON`, Save to a file / Open a file in the sheet's ⋯ menu).
- **Figures** (`groundAppreciation.figures`: `both` / `trace` / `map`): the trace is `aorMapSvg` (vector in the page
  and PDF, a PNG in Word and the slides); the map shot is the view as on screen when read.

## Slides

The Export menu's *Slides in the Briefing - PPTX* (one item per deck) writes a deck into the Briefing module (`features.briefing`): screen-only slides with native text and
tables, the trace as a picture, a section per part, the paragraph in full in the speaker notes, and each Confirm on Gr
item as a Task comment.

| Deck | Slides |
| --- | --- |
| `full` | a slide or more for each paragraph that has words; the approaches one by one |
| `decision` | aim, approaches, deductions, his options, relative strength, courses, the plan, confirm |
| `sand` | gen description, approaches, ITGs, obs, cover, deductions, confirm |

Each slide carries `sourceRef` (`aprc:<paragraph id>`) and `sourceHash`. On a refresh, slides that are not the
appreciation's stay; an appreciation slide the user edited is kept; the rest are replaced (`mergeDeck`). The deck uses
the copy chosen: the fair copy leaves proposals out.

**Look** (user, 22 Nov 2026: style B "Ops room" of `ground-appreciation-slides-options.html`; `DECK_THEME`): dark
slides (Segoe UI, the export keeps native text) with one frame on every slide: section and para at the head, the title,
Draft (draft copy), the deck, "Para in full in the notes" and the slide number at the foot. The full brief opens with a
cover (kind, place, mover, month, AOR, threat, when read, the trace) and puts a section slide before each group of two
or more paragraphs.
- **Points, not paragraphs**: the tool's draft a sentence a point (a long one of clauses split at its semicolons, a
  few-word sentence joined to the next); the planner's own words split by sentence only, never shortened; at most what
  fits at 3.1 % of the height, then "(cont)"; the paragraph in full in the speaker notes. Proposals follow the facts under
  their own tag (draft copy), or the slide carries the tag when it is all proposal.
- **Pictures**: Gen Description's going as a GO / SLOW-GO / NO-GO bar with its words; Apchs as the trace beside a table
  that compares them (past the front, narrowest, first obstacle) and the width a formation needs; each apch with that
  apch alone on the trace, its route on the title line, short facts and its significance (Definition, Depl Areas,
  Dominating Features, Dir Keeping in the notes); ground Deductions as the apchs ranked and the lines of def as a depth
  ladder with FDLs / Depth; Own Str as the table with paired en / own bars; Confirm on Gr as a checklist.
- **Tables** dark with hairline rules, sized to their words; rows that say nothing past their first cell are left out; a
  table under a paragraph (Assessment of Tasks: DP 1) gets a slide of its own; a heading two paragraphs share is told apart
  by its group ("Deductions: Gr and Weather"); Confirm on Gr lists each item once.
- **Maps**: drawn again for the slides from the last reading in the Gr Scope's dark style (JPEG; the attack's Lt / Rt
  mirrored to own side, `deckSideOfReading`); after a reload or an opened file the slides take the document's trace.
  **Previews**: each slide's thumbnail is drawn from its own content with the Briefing's `composeOverlayThumbnail`.

## API

```ts
const a = symbolEngine.groundAppreciation;        // null until features.groundAppreciation is on
symbolEngine.toggleGroundAppreciation(true);
await a.read();                                    // AprcDoc; read({ at: [lng, lat] }) sets the MITG
a.setText('gr.itg.mitg.effs', 'If lost, …');       // the planner's words
a.accept('gr.ded.pri'); a.acceptAll();
a.setCell('own.tasks.dp1', 0, 3, '1 x pair');      // a typed table cell (null gives it back)
a.planExtra(); a.loadPlanExtra(data);              // what Save Plan / Load Plan carry
symbolEngine.serializationEngine.registerPlanExtra(key, { save, load });   // any engine's data in the plan file
a.toText('fair'); a.toHtml('draft'); await a.toDocx('fair');   // string, string, Blob
a.toDeck('decision'); a.makeSlides('full');
a.toJSON(); a.fromJSON(doc);
```

Events on `document`: `aprc-read`, `aprc-changed` (detail `{ doc }`).

## Files

| File | Kind | Job |
| --- | --- | --- |
| `AprcModel.ts` | pure | The outlines (defence; attack from Mechs of Aprc (Attk), `MA` cites its sheet), numbering, states, whose words print in which copy, typed table cells (`tableOf`, `setCell`, `addRow`), carry-over between readings |
| `AprcWrite.ts` | pure | The words: `writeGround` (its attack branch from own side), `writeAttkDir`, `writeAttkPlan`, `writeSymbols`, `writeEnemy` (with his phases and clock times), `writeTasks`, `writeStrength`, `writeTimeReq`, `writePlan`, `writeCoyTasks`; first / last light, `parseHHour`, `clockAt`, `whenText` |
| `AprcHtml.ts` | pure | The page and the print document |
| `AprcDocx.ts` | pure | The Word package |
| `AprcDeck.ts` | pure | The slides (`DECK_IDS` by kind) and the refresh merge |
| `GroundAppreciation.ts` | engine | Collects the readings, the sheet, exports |

`node tools/aprc-test/run.mjs` runs 192 checks on the pure files (the attack's outline, numbering, copies, drafting, slides among them).

## The attack

Built 22 Nov 2026 from **"Mechs of Aprc (Attk)"** (`Material/Literature/1. Books/MECHS OF APRC - ATTK.pdf`, a Coy Comd's
attack appreciation, 21 scanned sheets; the sample IE `IE apprc.pdf` checked against it). The sheet's **Kind** select offers
*Attack*; changing kind starts the document again (it asks first when something is written).

**The outline** (`registerOutline('attk', 'Attack', outlineAttk)` in `AprcModel.ts`) keeps the book's paras 1 to 24 in its
order and numbering: REVIEW OF THE SIT (1 En, 2 Own, 3 Air), AIM (4, with its three limitations), FACTORS with Gr and Weather
(5 Gen Description, 6 Imp Tac Grs, 7 Apchs, 8 Obs, 9 Cover, 10 Met, 11 Deductions: Pri of Objs / ITG, Pri of Apchs / Dir of
Attk, Pri of Comb of Apchs, Attk Possibilities AP-1 / AP-2, Common Deductions), then 12 En Sit, 13 Own Sit, 14 Almt of Tps to
Task and 15 Time and Space as numbered paras of their own, COURSES (16 Course A, 17 En Reactions and Own Ctr Actions by
stage, 18 Analysis, 19 Course B, 20 Course Adopted with Reasons) and PLAN (21 Msn, 22 Exec, 23 Adm and Log, 24 Comd and
Sig). The book prints no page numbers: **"p N" is its N-th sheet**, and every ruled paragraph's prompts end with the cite
(`Mechs of Aprc (Attk) p 5`). The FACTORS heading the book leaves out is the IE's. The book's "l. Effect if captured" and
"m. Effs if Captured" are one head (m carries the six effects). Tables as the book draws them: Assessment of Tasks and Almt
of Tps to Task (Ser, Task / Loc, Inf (Sec), Armr (Tp), Aslt Pnr, Arty, BS / W pn Sec; rows Phase 1, Phase 2, BOF, Misc) and
the Backward Calc of Timings (its 18 events; the book's times are a specimen, so the times are the planner's). The book's
specimen wording is only ever a prompt. For a Bn the Exec and Comd heads follow the echelon (`attkHeads`: A / B / C Coy, Mor
Pl, Aslt Pnr Pl, Loc of Bn HQ).

**What it reads for the attack.** The MITG is the objective (a VG symbol, the selected symbol, the map centre or `at`).

| From | Through | Gives |
| --- | --- | --- |
| The ground, from own side | `GroundGuide.aorAround(obj, { from })` with the own start, else `{ away: true }` (read from the side away from the threat); the reading's sides are his, so they are mirrored to the attacker's Lt / Rt | 5, 8, 9, 10 as the defence; 7 Apchs onto the obj with the book's twelve heads in its order (Capacity by the book's 4 km for a Bde, p 2, and the IPB corridor widths below it, IPB book p 7; Depl Areas left to the planner); 6 Imp Tac Grs: the obj with the book's heads (Loc, Cover, Obsn toward own side, Domination from the ground; Effs if Captured a proposal) and his localities astride the apchs on the lines a defender of the MITG would hold; 4 Aim, 11a, 11c and Phases of Attk as proposals |
| The IPB reading onto the obj | `GroundGuide.ipbApproachesAround(start, { readFor: 'attack', objective, extras: true })` from the own start (else a point 3 / 5 / 10 km back on own side for a Coy / Bn / Bde, said so) | 11b Pri of Apchs / Dir of Attk: turning and flanks before frontal (the user's rule; the book pp 3-4), Lt against Rt weighed head by head (length, going, water lines, NO-GO on the assault; only past each head's smallest real difference, `LT_RT_MIN`), the turning apch onto the choke on his MSR (OoW Vol II s6; IBB S35 p 140); AP-1 from the flank the weighing favours with its FUP (IBB p 201) and the blocking posn at the choke; AP-2; the Best Dir of Attk on the MITG; the Annex A weather in Met |
| Symbols on the map | `writeSymbols` | 1 En, 2 Own, his disposns under Option 1, the strength counted |
| The ORBAT | as the defence, with the ratio **own to en** against the 3 : 1 an attacker wants (MW p 80); the en, when none is marked, one level down in def, inf (as Check my plan takes him) | 13b Own Str, 13a Composn and Disposn (with the disposns marked) |
| A checked attack | the Intelligent Deployment tab's Check my plan on an attack (`task: 'attack'`): each axis with its obj, FUP, SL and BOF, the phase, the recipe (Lt / Rt flank, frontal) | 16 Course A and 22a Gen Outline, AP-1 phases, FUP and BOF as drawn, Loc of Base of Fire, 22h(2) Loc, the tasks tables by phase (figures blank), 18 Advs / Disadvs from the check rows; its FUP is the own start the readings take |

A defence check is not read into an attack, nor an attack check into a defence. Nothing of the en's options, his caps,
the reactions, the timings or the plan's tasks is guessed: they stay ruled with the book's heads.

**Slides.** The decision and sand decks take their paragraphs by kind (`DECK_IDS`); the attack's decision deck reaches into
En Sit and Own Sit (Options Aval to En, Deductions, Own Str, Assessment of Tasks, Time Calc). A table that is only the book's
skeleton (its row names, nothing drafted or typed) makes no slide.

**Host API.** `read({ at, from })`: `at` the objective, `from` the own start ([lng, lat]).

## Not built yet

- The attack: the en's option against AP-1 (his sec disposns, killing areas, C attk objs) is not read from the ground; the
  Backward Calc of Timings is not filled (the H-hour sum of a built attack is not in Check my plan's report); the
  reactions by stage are the planner's.
- More than four lines of def (the reading gives W to Z).
- The move in by road: the straight line is a floor; the Move Planner's road engine is not called.
- Live-map slides (all slides are screen-only).
