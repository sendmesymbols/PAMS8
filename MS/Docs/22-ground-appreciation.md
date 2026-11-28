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
| The ground | `GroundGuide.aorAround()` (the Gr Scope AOR reading, the rail need not be open), `sectionsAround`, `coverAround`, `extendedAround` at the MITG and at three points along the home side of each approach | Gr and Weather: Gen Description, Apchs (twelve heads each; Obsn as the mean, spread and worst place of the three points), ITGs, Obs, Cover, Met Conditions, Deductions (lines of def: as many as the reading gives, front first by depth), DP 1 and DP 2 (the def stepped back to the depth line); the DP 1 tasks table and what it needs (Assessment of Tasks, Basic Deductions) |
| The IPB reading | `GroundGuide.ipbApproachesAround(mitg, { readFor: 'defence', threatDeg, extras: true })`: the en's avenues onto the position with the decision support (his time along each at the book's rates, TAIs, DPs), the Annex A weather and the doctrinal template (F need not be on). `threatDeg` is the bearing to the Threat marker when the host passes one (`host.threat`), else the AOR's facing | Options Aval to the En (Option 1 and 2 with places, times, template phase names, advs / disadvs; Most Dangerous when the two differ by 15 min or more; Most Probable: the reading's main avenue, a proposal), En Reactions and Own Ctr Actions (TAIs against DPs), the Annex A values in Met Conditions, Time Data (D Day, def occupied by H less the Time Req, ready by H with his earliest at the FDLs) |
| The Extended View's IPB fire and air | the fire / air on the host view when it carries them, else the Extended View's live reading (`ipbApproaches().fire`, `ipbAir()`) when its area is anchored within 2.5 km of the MITG (F on, `extended.ipb.fire` / `air`) | DP 1 Killing Areas (OoW Vol I pp 42-45), DF, Surv and Obs Plans; En Sit Common Deductions: his likeliest LZs / DZs and air avenues (IPB pp 5-6; LZ sizes FM 3-21.38, US, to confirm). Without them the four DP heads say how to get them |
| Symbols on the map | `SerializationEngine.planRecordsOf()` → `PlanCheck.readSymbols` | En Forces, En Composn and Disposn, Own Forces, Composn, Disposns, the relative strength table (counted by echelon), obstacle symbols in Obs, own HQ symbols in Comd and Sig (attack: Loc of HQ) |
| The Admin Area finder | `host.adminArea()?.result` (when the host passes the finder) | Adm and Log: its best sites, a proposal to walk |
| A checked plan | the Intelligent Deployment tab's last Check my plan (`DeploymentBuilderEngine.planCheck`) | Own Disposns, Course A, advs / disadvs, en reactions against own moves (replacing the IPB table), the general outline |
| The ORBAT | `groundAppreciation.orbatUrl` (default `/MS/Data/Orbat/PK`, as the Intelligent Deployment tab reads it), `PlanOrbat.brief`, `PlanEngr.ownEngrTypes` / `minesByEngr` | Own Str as Related to that of the En (manoeuvre Coys, all ranks, ATGM, mortars, ratio en to own), Composn of Own Forces, the Pls held against DP 1 and the ATGM pairs, the protective minefield's hours in Time Req |
| Doctrine files | `PlanDoctrine.json` (`readyBy.coyPosnH`: IC s75 p 399; `enemy.defaultUp` / `defaultType`), `MoveDoctrine.json` (`road.speeds`: SO's Hbk Sec 9 / SD Vol II) | Improvement of def posns, the move in, the en assumed when none is marked |

The MITG is a VG symbol, else the selected symbol, else the map centre. The AOR is the Bdy symbols, a drawn box or the
echelon frame, as the Gr Scope AOR setting says (`groundGuide.aor.source`).

**Terrain bundle.** The engine reads the bundle only through the Ground Guide. With the guide off or no bundle, the
sheet still opens, takes the planner's words and exports; the Gr paragraphs stay ruled and the sheet says why, with a
button to turn the guide on.

**A reading is never lost** (23 Nov 2026). Every draft carries the reading it came from (`src`: `gr`, `map`, `plan`,
`en`, `orbat`, `time`). A Read that cannot take a reading again (the guide off, outside the terrain data, a time-out, no
IPB avenue, no ORBAT) keeps what the sheet held from it (`keepUnread`): the Gr paragraphs, the frame, the data list, the
figures, their Confirm on Gr items, and says so ("Gr not read this time: the reading of 2027-02-15 11:00 kept"); only what
was read again is replaced. A sheet kept before `src` existed has it told from the paragraph ids on open. A Read writes
nothing to the sheet until it is done: an overtaken or cancelled Read changes nothing. **Cancel** (the Read button while it
runs) stops it; the header shows the step and the seconds ("Obsn along the Lt apch 2/3 … 14 s").

## The sheet

Redesigned 22 Nov 2026 (the impeccable design pass): one workflow, Read → settle each paragraph → export.

- **Header**: the kind, what the reading was taken with (echelon, place, mover, month, when), **Read** / **Read again**
  (a thin bar runs under the header while it reads), **Export** (Word, PDF, Copy as text; Slides in the Briefing - PPTX, one
  item per deck) and **⋯** (Save to a file, Open a file, Clear: asks twice, in the menu, not a dialog).
- **Header** also carries a state dot (busy, a failure, read), the **messages** button (the last ten with their times, M)
  and, while Read runs, **Cancel** in place of Read. A question (change of kind with words written, H on a sheet from an
  earlier session) comes as a bar under the header with two buttons, not the browser's confirm; Esc answers no.
- **Outline** (left): how many paragraphs are ready for the fair copy and a bar by state; filters **All / To do /
  Proposals / Look again / Changed / Written** (To do = yours to write + proposals open + look again); *Accept all n
  proposals*; under them the last Read's time, how many it changed and *Confirm on Gr n* (they stay after the toast).
  **Changed**: what the last Read (or a new H) changed in a draft carries a blue dot in the outline and, in the inspector,
  what it said before ("Before this Read: …").
  Each top-level paragraph carries the worst state under it as a shape and a word, never colour alone: ✓ written by you,
  ● drafted from Gr, ■ from the map, ◇ proposal open, ◆ proposal accepted, dashed ○ yours to write, red ! Gr changed. Under a
  filter a row goes to the first paragraph it shows.
- **Page** (centre): the page as it prints; *Fair copy* / *Draft copy* and *H on D Day* above it. Click a paragraph to
  select it, double-click to write in it.
- **Inspector** (right): ↑ ↓ and *Next to do*; the paragraph's state with what to do about it (Accept / Take back; Keep
  mine / Use the new reading), the box (*Save as mine*, Ctrl+Enter; what is typed is saved when the planner moves to another
  paragraph, reads, exports or closes, so nothing typed is lost), the table, the sub-paragraphs, To consider, Rests on,
  Confirm on Gr. With nothing selected: the three steps, what the marks mean, the keys.
- **Keys** (in the sheet, never reaching the map): ↑ ↓ (or J K) paragraph, N next to do, A accept, Shift+A accept and go to
  the next to do, Enter write, Ctrl+Enter save, F fair / draft copy, X Export, C Confirm on Gr, M messages, Ctrl+Z undo,
  [ ] fold the outline / the paragraph panel, Esc leaves a box, then closes. In a table cell Enter saves it and goes down a
  row, Tab across. Tab stays inside the sheet while it is a window (not folded to its bar). Alt+A (global) opens / closes it.
- **Undo**: Clear, *Use the new reading* / *Give back to the tool*, opening a file and a change of kind can be undone
  (the toast's Undo, Ctrl+Z) until the next change; a Read that the change started keeps the Undo. Words given back stay
  on the paragraph (*Put back*).
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
  double-click on the title bar) docks it under the host's bar, and back. Minimized, it folds to a bar at the right under
  the host's bar (clear of the Ground Guide key notice and the Platoon Guide answer bar at the foot) with the state dot,
  Read (Retry after a failed Read) and the progress (ready, to do); a click on the bar, its Restore button or the top bar's Aprc
  button brings it back as it was. The bar can be dragged anywhere (a click without moving restores); its place is kept
  in this browser and held inside the window. What was typed is kept, and the keys go back to the map. A read carries on while it is
  minimized. Hosts: `windowState`, `setWindow('normal' | 'max' | 'min')`.
- Messages come as a toast at the foot of the sheet (read out once; a failure stays longer). Below 940 px the outline is a
  drawer (☰ over the page) and the inspector sits under the page.

## The rules of the document

1. **Four states.** A paragraph is drafted from the ground (GR), read from the map (MAP), proposed for judgement
   (YOU JUDGE) or left to the planner (YOURS, a ruled line with the heads to consider).
2. **What the planner writes is his.** *Save as mine* on a paragraph; Read never overwrites it. When the reading under
   it has changed since, the sheet says so, says **what** changed (Gr, the map, the plan check, the en options, the
   ORBAT, the timings, or H: "H changed since you wrote this"), and shows the new reading; it does not replace his words.
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
its first column and your cells until you accept it. Typed cells are kept by the **row** (its naming cell, the first that
is not a serial, times taken out; `rowKeys`), not its index, so a new reading that adds, drops or reorders rows leaves
them on their rows; a row of his that is gone keeps his cells as an added row, named, and the paragraph asks to be looked
at again (*Keep my rows* / *Use the new reading*). Cells kept as "row,col" before are re-keyed on open.

**H** changes re-time only what carries a time: his times and phases, the reactions table when it is the en options'
(a table a plan check settled stays), the Time Data and the attack's Time Calc (`retime`).

**First and last light** are in the place's zone, `groundAppreciation.utcOffsetH` (default 5, PKT), said in the text
("UTC+5, PKT"), never the computer's.

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
- **PDF** (`exportPrint`): the same page through the browser's print (Save as PDF). The marking's ruled line heads and
  foots every page from a repeating table head and foot (Chrome and Firefox; no margin boxes needed); the page number
  sits in the top margin where the browser draws margin boxes. The print title is the file name
  (`Aprc_<place>_<date>[_draft]`, `aprcFileBase`), so Save as PDF offers it. The print frame goes on `afterprint`.
- **Text** (`toText`, `copyText`), **file** (`toJSON` / `fromJSON`, Save to a file / Open a file in the sheet's ⋯ menu).
  Save to a file leaves the pictures out by default (a few KB; Read makes them again); *Save with the pictures* keeps
  them. Opening a file (or a plan) makes it safe (`normalizeDoc`: missing arrays given), and the sheet's kind and its
  setting follow it.
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
- **PowerPoint** (checked in PowerPoint itself, 22 Nov 2026, the Sialkot deck of 23 slides): native text boxes, tables and
  pictures, Segoe UI, speaker notes, and the Confirm on Gr items as PowerPoint comments. Two exporter faults found and fixed
  on the way: a typed comment (task, risk ...) linked its sidecar to a part that was not there, so PowerPoint refused the
  whole deck as corrupted (`PptxComments.ts` `TYPED_SIDECAR_TARGET`); and the exporter drew the slide title again over a
  slide that already shows it (`PptxExporter.ts` `titleShownBy`: such a title now goes just above the slide, for the outline).

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
a.toJSON({ pictures: false }); a.fromJSON(doc);    // fromJSON: the kind follows the doc; Undo brings the old sheet back
a.cancelRead(); a.undo(); a.giveBack(id); a.putBack(id);
a.setH('06:00');                                   // re-times only what carries a time
a.setLimits({ fwd: true, noPen: 'Y', by: '0600 D Day' });   // the aim's limitations; null clears them
a.setDDay('2027-02-15'); a.setNow('D-1 1000');    // first / last lt and the moon; the time aval
```

Host: `adminArea?: () => engine` (its `result`) feeds Adm and Log; `threat` (the Threat marker) is read for the en's
direction and said in the frame.

Events on `document`: `aprc-read`, `aprc-changed` (detail `{ doc }`).

## Files

| File | Kind | Job |
| --- | --- | --- |
| `AprcModel.ts` | pure | The outlines (defence; attack from Mechs of Aprc (Attk), `MA` cites its sheet), numbering, states, whose words print in which copy, typed table cells by row (`tableOf`, `setCell`, `addRow`, `rowKeys`, `keepMoved` / `dropMoved`), carry-over between readings, `keepUnread`, `markChanges`, `retime`, `staleWhy`, `normalizeDoc`, `uniqueId` |
| `AprcWrite.ts` | pure | The words: `writeGround` (its attack branch from own side), `writeAttkDir`, `writeAttkPlan`, `writeSymbols`, `writeEnemy` (with his phases and clock times), `writeTasks`, `writeStrength`, `writeTimeReq`, `writePlan`, `writeCoyTasks`, `writeFire`, `writeAir`, `writeTimeData`, `writeTimeCalcAttk`, `writeAdm`; first / last light, `parseHHour`, `clockAt`, `whenText` |
| `AprcHtml.ts` | pure | The page and the print document |
| `AprcDocx.ts` | pure | The Word package |
| `AprcDeck.ts` | pure | The slides (`DECK_IDS` by kind) and the refresh merge |
| `AprcMechs.ts` | pure | The two Aprc books' mechanics: `layoutDef` / `coysUp`, `analysisDef`, `courseDef`, `visDef`, `writeTsDef`, `writeAim`, `apchTestsAttk`, `timeCalcAttk`, `nightOf`, `writeSketch`, `styleNotes`, `writeMechs`; `parseDTime`, `dClock` |
| `AprcBooks.ts` | pure | The doctrine books' figures and heads (Doctrine_Review.md R69-R93): `GUN_DEPL`, `QUICK_ATTK`, `slantFactor` / `mtnAssault`, `MW_LIFT` / `liftDraft`, `LSF_CAS` / `casGroupsOf` / `casEstimate`, `readHeads` |
| `GroundAppreciation.ts` | engine | Collects the readings, the sheet, exports |

`node tools/aprc-test/run.mjs` runs 322 checks on the pure files (the attack's outline, numbering, copies, drafting, slides, readings kept, changes, typed cells by row among them).

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
| The ORBAT | as the defence, with the ratio **own to en** against the usual 3 : 1 an attacker keeps (IBB p 248; in mountains comparatively more, in sequence, MW p 80); the en, when none is marked, one level down in def, inf (as Check my plan takes him) | 13b Own Str, 13a Composn and Disposn (with the disposns marked) |
| A checked attack | the Intelligent Deployment tab's Check my plan on an attack (`task: 'attack'`): each axis with its obj, FUP, SL and BOF, the phase, the recipe (Lt / Rt flank, frontal) | 16 Course A and 22a Gen Outline, AP-1 phases, FUP and BOF as drawn, Loc of Base of Fire, 22h(2) Loc, the tasks tables by phase (figures blank), 18 Advs / Disadvs from the check rows; its FUP is the own start the readings take |

A defence check is not read into an attack, nor an attack check into a defence. Nothing of the en's options, his caps,
the reactions, the timings or the plan's tasks is guessed: they stay ruled with the book's heads.

**Slides.** The decision and sand decks take their paragraphs by kind (`DECK_IDS`); the attack's decision deck reaches into
En Sit and Own Sit (Options Aval to En, Deductions, Own Str, Assessment of Tasks, Time Calc). A table that is only the book's
skeleton (its row names, nothing drafted or typed) makes no slide.

**Host API.** `read({ at, from })`: `at` the objective, `from` the own start ([lng, lat]).

## The two Aprc books (24 Nov 2026)

The user gave **"Understanding Aprc - I"** (Maj M Zeeshan Asghar Ch; `Material/Literature/1. Books/12. Understanding Aprc.pdf`,
a Bn-level study guide with a text layer: planning parameters, 2 up or 3 up, the vis of the en op and its linear models, the
tablets of deduction heads, the sketch lists, def and attk specimens) and **"Mechs of Aprc (Attk)"** again, and chose all four
refinements below. **Precedence (the user's ruling):** where a pamphlet prints a figure (IBB, OoW Vol I, the IPB book) it
drives the draft and the guide's figure is shown beside it in the basis; a guide's figure drives only where no pamphlet
prints one, and the basis says so. A Coy's attack takes Mechs of Aprc (Attk), a Bn's or a Bde's Understanding Aprc. Cites:
`Understanding Aprc p N` is its Sec I (Mechanics) printed page; `Sec II sheet N` etc. its specimens; `Sec V p N` the tablets
and linear models. The pure module is `AprcMechs.ts`; `writeMechs` runs at the end of every Read and again (through
`retime`) when H, D Day, time now or a limitation changes.

**The aim's limitations.** Selecting the Aim shows a **Limitations** box. Defence: as far fwd as tac feasible, no pen beyond
line W / X / Y / Z, def a place at all costs, cause max attrition, delay the En for N hrs, not more than N Coys, ready by a
D-time, a salient, the En has pen, others one a line. Attack: captured by a D-time, max destr (blocks the En wdr before the
attk), at ni, the obj a tough area with bunkers, others. They are kept in the document (`doc.limits`, carried by Read, the
file and the plan) and draft the aim as the book writes it: "To def the given AOR with fol limitations:-" with the
limitations tabulated (pp 7-8, 22). With no ready-by given and H set, the def is to be ready by the last lt before the En
attk (p 8), a proposal. API: `setLimits(patch | null)`, `limits()`.

**The def laid by the aim** (`layoutDef`, pp 3-4): no pen beyond a line: the depth on it, the FDLs on a line 3-5 km ahead
(the line of no pen, OoW Vol I p 17); as far fwd as tac feasible: the FDLs on the line 5-8 km past the border (a Bn;
another echelon is told the figures are a Bn's); def X at all costs: the depth on X; a salient and a pen are prompts.
**Coys up** by the FDL frontage on IBB Annex U App 6 p 481 (two up 4.5 km, three up 6.5 km, wider an extended frontage,
OoW Vol I pp 5, 82-83), the guide's table beside it (p 4: up to 6.5 km 2 up / 2 up, 7-10 km 3 up / 2 up, beyond 10.5 km 3 up /
3 up). The depth line at the pamphlet's Bn depth (2.5-4 km), the guide's 3-5 km beside; screens 1-1.5 km ahead of the
FDLs (pp 2-3; a screen always, OoW Vol I Annex A p 102); protective dets where the parameter puts them, an adv posn on a
natural obs (OoW Vol I p 14). Drafted into Lines of Def (pri with the reasons for pri 1) and DP 1, with three new DP heads:
**C Pen Posns** (1,500 m behind the FDLs on the most threatened apch, p 14; IBB p 310 for the time), **Res** (p 6; OoW Vol I
pp 19-20) and **Use of Armr / ATGM** (pp 5-6; OoW Vol I p 21; IBB S54 pp 281-282).

**Course A and its analysis.** Course A is written as the book's paragraph (p 11): def along the line, FDLs and depth
(a Coy to each BUA, or the plan check's posns), screens, protective dets, res, C attk objs in pri, C pen posns, the bias of
def and of A tk def, commencing and completing the prep; what the data cannot give is named in its prompts. Advs and
disadvs under the guide's heads (Aim, Lines of def, Protective dets, Apchs, Minor; Sec II sheet 10), the limitations turned
into advs (p 12), the plan check's rows after them.

**Vis of En Op** (a new para in En Sit) tier by tier at the guide's figures (pp 9-11; the linear models Sec V pp 5-8): H is
when the En crosses the border; the SZ cleared at 1 km/h (KYE 2019 p 216 beside), a delay line held 4 h (6 along an obs or
BUAs), the screens 1 h, probing the rest of the day lt, the En attk after last lt and not before 2200 hrs, Ph 1 4 h, Ph 2 2 h,
12 h to recycle before the str pt; best to the En (the earliest times), "En is likely to". The **En Reactions and Own Ctr
Actions** table is laid in the three phases of the def battle (prep, aslt, C attk; p 13, Anx A pp 27-28) with the IPB
decision rows in prep and the plan's what-if rows in C attk; the C pen posn occupied not later than 1.5-2 h after the En H
(IBB p 310).

**Time and Space (def).** The sheet's header takes **D Day** (a date: first / last lt and the moon are worked out for it)
and **Now** (a D-time, "D-1 1000"); `setDDay`, `setNow`, settings `groundAppreciation.dDay` / `timeNow`. Time Data gains
Time Now, First Lt and Last Lt and the time aval split into day lt and ni hrs. The Time Req takes the guide's standard list
(battle procedure, C pen, screens, rehearsals, OHP, cam and clt, F of F, wire, coord, Bde rehearsals: the specimen hours of
Sec II sheet 7, said so) and, for a Bn or Bde, the prep of the main def at 36 working hours (OoW Vol I p 39); two totals, one
row after the other (as the specimen adds them) and the critical path. Essential timings back from the ready-by; less or
more time aval with the pri of work (Sec IV pp 7-8).

**The attack.** Pri of Apchs gets **Apchs on the Planning Parameters** (pp 16-17): per own apch, the FUP in own area (the FUP
1,000-1,200 m short, IBB p 201; the guide's 1,000-1,500 m beside), a BUA in Ph 1 (confirm its size: 500 x 500 m or more of
pakka houses rules it out), Ph 1 ending on a distinguishable feature, the MITG in Ph 1, a Pl or more of the En marked on it
away from the obj (discard), room for the force (IPB book p 7). Capacity of an apch now by the IPB widths (Coy 0.5, Bn 1.5,
Bde 3, Div 6 km), the guides' 4 km (Mechs p 2) and 2.3 / 3.2 / 6 km (p 18) beside. The analysis of AP-1's apch takes the
tests. The **Time Calc** is worked out in the book's 18 rows: the plan's march, assault and Phase 2 when Check my plan timed
them, else the books' minutes (a Coy: Mechs p 14 and p 5; a Bn: pp 21, 24, the assault at 100 m in 3 min from the FUP),
backward from the captured-by time (H not later than), forward from H otherwise (Mechs p 13). It reproduces both books'
specimens (a Bn: H 0110, A hr 0348; a Coy: H 0200, A hr 0315). With the night of D Day the mov from the FAA, H and Ph 1 are
kept in the dark: "adv all timings by N" when a shift does it (Sec III sheet 7), else at least H and Ph 1 with the mov by covered routes and smk, never past the msn time. Time Data, Essential Timings (BOF by
H-45, blocking posn H-20, feint H-30; pp 19-20) and more / less time (Mechs p 15) follow; Timing of Attk gives the moon's
quarter, when it is up and the dark spans (moonlight: 5 degrees up and a quarter lit), with dawn and dusk in the prompts
(OoW Vol II pp 26-27).

**Deduction heads, tables and the sketch.** The def's common deductions carry the tablets' heads (Sec V p 1) as prompts;
the DP 1 tasks table takes the guide's columns (Inf Pl, Armr Tp, LAT Pl, HAT Pl, Engrs Sec, Remarks; rows for flk
protection, res and obs laying); typed cells follow a renamed column by its head (`colMap`). A new annex part, **ANX P:
SKETCH**, numbered afresh, lists the **Details to be Marked** (def Anx P pp 31-32, marked two steps down p 14; attk Anx Q
pp 34-35) with what of each is on the map (symbols by name and label, the plan check's posns, by hand, by eye).

**The books' writing rules** (`styleNotes`): the aim starts with "To" (pp 8, 22); in the def a course does not (p 11), a
deduction never opens with "Keeping in view" (p 8), the Vis says "En is likely to" and holds no own response (p 9), an adv
names the ground (p 12). The notes show in the paragraph panel and as "Writing rules N" under the outline's progress; the
attack keeps "Keeping in view" (the guide's own attk specimens use it).

## The doctrine books (24 Nov 2026)

The GroundAppreciation rows of `Doctrine_Review.md` (R65-R93), filled from the books the user gave (IBB, OoW Vol I / II, DW,
MW, MIB, lsf, IDD, SO's Hbk 2019 Sec 12). Every figure carries its book and printed page; where a book prints no figure the
text says so; where two books differ both are kept. Figures and the heads a Read adds live in `AprcBooks.ts`; the heads to
consider are prompts in the outlines (`AprcModel.ts`); the drafts ride in `writeTimeReq` and `writeMechs`.

| Row | What the sheet does | Book and page |
| --- | --- | --- |
| R69 | Time Req (def): **Depl of the DS fd Bty** (a Bn) / **fd Regt** (a Bde), at the ni figure, not on the critical path; the attack's essential timings: the DS guns to start their depl not later than H-40 min (ni) / H-20 (day), a Bde's Regt H-90 / H-45 | IBB p 122 para 5 (Bty 20 / 40 min, Regt 45 / 90, med 30 min / 1 h and 1 / 2 h, registration 20 min each + 20); p 154 (ni without daylight recce: Bty 2 h, Regt 4-5 h, Div Arty 12-14 h); p 170 para 5 (arty orders may govern H) |
| R70, R82 | Limitations box (attack), **A quick attk**: the Time Calc's rows before H become contact to H, a Bn by the Annex L drill (recce H-100 to H-60, orders H-50 to H-35, in the FUP H-10: 100 min), a Coy 45 min (inside MIB's 30-60 and IBB's at most 30-45); essential timings say "Contact not later than". In the def the reactions table's Aslt Ph gets the En's quick attk off contact (a Coy gp 30-60 min, a Bn gp 60-100 min) | MIB p 89, pp 96-97, Annex L pp 347-348; IBB p 133 |
| R72 | The Vis's basis: an En Bn's Ph 1 not complete 1.5-2 h after H, a Bde's 3 h; an En Bde attk in at least two phases to 2,000-3,000 m. A depth under 2 km cites p 312 | IBB S57 para 11 p 310, para 17 p 312 |
| R74 | Limitations box (def), **Line of denial (given)**: tabulated in the aim ("Integrity of Line Y, the line of denial, to be preserved"); with no line of no pen set it lays the def as one; a line of no pen behind it is flagged; the analysis says whether the def preserves it. A Bde / Div AOR's depth line is tested on its obs. The line is drawn on the trace (a band under it, "Line of Denial" beside its letter: `AorFrame.denial`, `aorMapSvg`), on the slides' traces, and listed in the sketch annex (on the trace or not); changing it draws the trace again | OoW Vol I pp 17-18 (para 24 a, e, f; para 25) |
| R75 | DP 1 Res prompts: the four factors, the three decisions (point, timing, dir), contingencies | OoW Vol I pp 19-20 |
| R77 | Attack: **Leading En Option** (under the options), **Emp of Res** (Own Sit common deductions), **Contingency Plans** (Exec, after Coord Instrs), silent / noisy in Use of Arty | OoW Vol II pp 27, 30-32 |
| R79 | Desert ITG heads (def ITGs, attack Pri of Objs) | DW pp 7, 20, 38 |
| R80, R88 | Time Req's prep row on the ground read: desert trenches by frames (6 h a wpn crew, 4-6 h for the frames; fwd and rev slope double the stores); mountains (digging slower, no figure; cold-weather maint 5 times) | DW Annex B p 97, p 95; MW pp 147, 262 |
| R81 | A Read with a mounted own unit (ORBAT APCs) adds **Dismounting Area** to AP-1's Depl Areas | MIB pp 90, 120-123 |
| R83 | Def prompts: the Gr from the En view, interdiction tgts, spoiling attks; think two down in the DP 1 tasks | MIB pp 161-162 |
| R84 | DP 1 Str Pt prompts (mountains): a Pl str pt with 30 days a Coy posn, posts 7 days, 1/3 always in it; pri of work | MW pp 151-152, 166, 172, 176 |
| R78 | Kind **Withdrawal** (`wdr`): REVIEW OF SIT, AIM, FACTORS as the book groups them (Terrain and Weather, Time and Space, Own and En Sit, Int / Security / Deception, Dmls / Air / Adm), COURSES with the main decisions, PLAN as the orders and Annex A's exec para, Anx P sketch (Annex P / Q). A Read takes the AOR round the MITG as the new def posn: Gen Description, Apchs, Obs, Cover, Weather (`writeGround`), Routes Back, the new posn's lines, the lines forward of it as intmed posns (those on an obs first), routes to keep open / block, brs on the En apchs (`writeGroundWdr`). Limitations: new posn, posn denied until, no rearward mov before, all tps clear of a line by, delay fwd of the new posn, by day; they draft the aim, the time data (last lt D Day, first lt D+1, hrs of darkness), the Time Req (new posn 36 working hrs a Bn, 12 h a Coy), the essential timings (prep NLT, finish before first lt, mov to the rear in darkness, short / in time), ni or day with the moon, the sequence (`writeTsWdr`) | OoW Vol III pp 1-16 (main decisions pp 6-7, factors pp 7-16), 19, 24, 31-35, 39-45, 54-56, 68-70, Annex A pp 71-74, Annexes P, Q pp 75-76; OoW Vol I p 39 |
| R85 | Limitations box (attack), **Climb SL to Obj (m)**: the FUP-to-obj row on the slant (factor table, the row at or next above the angle; none below 30 degrees) plus 1 h for every 350 m of climb. In mountains a Read takes the climb off the 30 m elevation through the Ground Guide (`sectionsAround` at the checked plan's SL, else its FUP, else the leading apch's FUP, against the MITG's), the angle on their map distance; a typed climb overrides it; the Time Calc says which it used | MW Annex F pp 311-313 |
| R86 | A Read in mountains adds **Mules and Porters** under Adm and Log: the attack's build-up and maint (a Bn 16 vehs, 582 mules / 1,164 porters; a Bde 1,746 / 3,492), F ech pri 1 / pri 2; the def's maint (158 mules a week, 123 a lift of amn; a Bde's not printed) | MW pp 142, 145-146, 322-325, 330-331 |
| R90 | Def Adm and Log prompts: commodity pts and their hours, 1st line holdings, cas evac 4 h / 12 h | lsf pp 23-27, 47, Annex L pp 81-82 |
| R91 | A Read with the ORBAT adds **Cas Estimate** under Adm and Log: own strength by rank and arm (the ORBAT's offr / jco / sldr) at the battle cas rates, intense / moderate / low, the sick at 0.10 %, ADS needed at 75 a day | lsf pp 47-51, Annex K p 80 |
| R92 | Attack, the En on a DCB: its obs plan, strengths and vulnerabilities as prompts | IDD pp 3, 5-8 |
| R93 | Air sp requests (pre-planned up fd units, Bde HQ, Div HQ, ASOC; emergency) in Coord Instrs (def) and DF Plan (attack) | SO's Hbk 2019 Sec 12 pp 1203-1204 (no timings printed) |

The heads a Read adds (`readHeads`) stay on a later Read where the planner wrote in them, or where the reading behind them
was not taken that time; otherwise they go with the condition.

## The five books re-read (28 Nov 2026)

GSP-1947 *Infantry Division in Battle* (cited "GSP-1947"), IBB, OoW Vol I / II, Mountain Warfare and Desert Warfare,
checked against the module: findings and their status in `Aprc_Review.md` (repo root). Every page was checked in the PDF.
The ground comes from the AOR reading's country (`AprcBooks.groundKind`: Mountains, Desert, else the plains).

- **Frontage (fix):** a Bn normally holds 3,000-5,000 m in the plains (IBB S53 para 4 c pp 276-277); past it the frontage
  is extended, laid two Coys up on 4,500 m or three up on 6,500 m (IBB Annex U App 6 p 481, the extended frontages'
  annex). Along a water line 24 m or more wide (IBB S60 p 331; `wideWaterOn`) three Coys up to 4,115 m (IBB S61 p 333,
  Annex V p 483). Mountains and desert print no Bn figure: IBB's are taken, the book's rule beside (OoW Vol I p 72; DW
  p 22, GSP-1947 p 172). Course A takes DP 1's Coys up when the line has fewer BUAs.
- **A Bde (fix):** its depth line is looked for 4-6 km behind the FDLs, and DP 1 FDLs gives its front against the
  yardstick of 10-12 km (OoW Vol I Annex B p 103), or on a DCB up to 8,000-10,000 m with all three Bns three up
  (GSP-1947 p 119 para 5, pp 120-121). Its res is no longer the guide's Bn res: strong in armr, as mobile as the En (OoW
  Vol I pp 18-19), a Div res holding the LAT Bn beside it (GSP-1947 p 122 para 3).
- **By ground (DP 1, `AprcBooks.GROUND_DEF`):** mountains hold the dominating features astride the main axis, the M fds
  thickest in the valleys, the res split (MW pp 147, 150, 169; GSP-1947 pp 175-176); desert localities with large gaps,
  held by fire, str pts adm self-sufficient, covering tps rather than an adv posn, a third or more as res mainly armr
  within 2-6 h, the C pen mode less preferred, ATGMs concentrated (DW pp 21-28, 58; OoW Vol I p 71).
- **A tk (fix):** HAT in bulk on the most threatened tk apch, never spread evenly (IBB p 73; OoW Vol I p 26).
- **Protective dets and C pen:** never so large as to weaken the main def, never reinforced (OoW Vol I p 13; GSP-1947 p 105
  para 10); C pen posns planned and prepared at the outset (GSP-1947 p 109 para 22).
- **Vis:** a mountain step (selective punishment of posts, multidirectional attks with infiltration, MW pp 164-165) and a
  desert one (he outflanks the def; fight the battle outflanked, DW p 13).
- **Time Req:** in desert the M fd is timed by hand, MMLs fail in loose sand (DW p 65; `minesHours`, also the essential
  timings); the guns row says sections near hairpin bends in mountains (MW pp 240, 244), towed guns in loose sand (DW p 60).
- **Attack:** FUP in mountains (no classic FUP, MW p 85; NVDs, p 228); the dir of attk carries MW pp 78-79 / DW pp 34, 38
  (`AprcAttkIn.country`); heads for the aslt frontage by echelon and ground (IBB p 248; GSP-1947 pp 86-88; DW p 47), main and
  secondary attk, prelim ops, an obs aslt at two places, reorg (GSP-1947 pp 84, 89-91), the En res times (GSP-1947 p 83, IDD
  p 5 beside), mountain and desert heads (MW pp 80-86; DW pp 38-39, 46-48).
- **Withdrawal:** GSP-1947 s30 beside OoW Vol III (pp 143-149; IBB p 378), and no wdr on foot in desert (DW p 32).
- **Cites:** the climb rule is MW Annex F p 313 para 3 c; the def's amn lift (123 mules) notes that its rows add to 101.

## Not built yet

- The attack: the en's option against AP-1 (his sec disposns, killing areas, C attk objs) is not read from the ground; the
  Time Calc takes H, and the plan's march, assault and Phase 2 only when the check carries an "H-hour sum" row (Check my
  plan's report does not yet: `PlanCheck` would have to add `hSumRow`); the reactions by stage are the planner's.
- More than four lines of def: the sheet takes as many as the AOR reading gives, but `GroundGuideAor` still picks at most
  three lines plus Z.
- The fire and air paragraphs need the Extended View's live reading at the place (F with IPB fire / air on);
  `ipbApproachesAround(..., { extras: true })` does not return them for a host.
- Adm and Log from the Admin Area finder needs the host to pass `adminArea` (SymbolEngine does not yet).
- The move in by road: the straight line is a floor; the Move Planner's road engine is not called.
- Live-map slides (all slides are screen-only).
- From the doctrine review: the AOR lines' 1,800 m spacing (`GroundGuideAor`, no book figure: M) is the Ground Guide's;
  the Gr Scope rail draws a line of denial only when its frame carries one (`AorFrame.denial`), and the guide does not
  set it yet; the climb read is the height difference of the two ends, not the ascent along the way; the withdrawal
  does not read Check my plan's built withdrawal, the ORBAT or the move back by road; the sub-conventional outline (R89)
  is out of scope.
