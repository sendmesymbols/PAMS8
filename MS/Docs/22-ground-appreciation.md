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
times: each fight adds to them, and the text says so. **H** (the box in the sheet's tool bar, `groundAppreciation.hHour`,
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
- **Text** (`toText`, `copyText`), **file** (`toJSON` / `fromJSON`, Save / Open in the sheet).
- **Figures** (`groundAppreciation.figures`: `both` / `trace` / `map`): the trace is `aorMapSvg` (vector in the page
  and PDF, a PNG in Word and the slides); the map shot is the view as on screen when read.

## Slides

*Make slides* writes a deck into the Briefing module (`features.briefing`): screen-only slides with native text and
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
| `AprcModel.ts` | pure | The outline, numbering, states, whose words print in which copy, typed table cells (`tableOf`, `setCell`, `addRow`), carry-over between readings |
| `AprcWrite.ts` | pure | The words: `writeGround`, `writeSymbols`, `writeEnemy` (with his phases and clock times), `writeTasks`, `writeStrength`, `writeTimeReq`, `writePlan`, `writeCoyTasks`; first / last light, `parseHHour`, `clockAt`, `whenText` |
| `AprcHtml.ts` | pure | The page and the print document |
| `AprcDocx.ts` | pure | The Word package |
| `AprcDeck.ts` | pure | The slides and the refresh merge |
| `GroundAppreciation.ts` | engine | Collects the readings, the sheet, exports |

`node tools/aprc-test/run.mjs` runs 141 checks on the pure files.

## The attack

`AprcKind` is `def | attk`. Only the defence has an outline. The attack has its place: `registerOutline('attk', label,
build)` adds its headings and a writer fills them, with no other change. It waits for a specimen.

## Not built yet

- The attack's outline (waits for its specimen).
- More than four lines of def (the reading gives W to Z).
- The move in by road: the straight line is a floor; the Move Planner's road engine is not called.
- Live-map slides (all slides are screen-only).
