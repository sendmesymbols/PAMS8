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
| The ground | `GroundGuide.aorAround()` (the Gr Scope AOR reading, the rail need not be open), `sectionsAround`, `coverAround`, `extendedAround` at the MITG and at one point on each approach | Gr and Weather: Gen Description, Apchs (twelve heads each), ITGs, Obs, Cover, Met Conditions, Deductions |
| Symbols on the map | `SerializationEngine.planRecordsOf()` → `PlanCheck.readSymbols` | En Forces, En Composn and Disposn, Own Forces, Composn, Disposns, the relative strength table (counted by echelon), obstacle symbols in Obs |
| A checked plan | the Intelligent Deployment tab's last Check my plan (`DeploymentBuilderEngine.planCheck`) | Own Disposns, Course A, advs / disadvs, en reactions against own moves, the general outline |

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
a.toText('fair'); a.toHtml('draft'); await a.toDocx('fair');   // string, string, Blob
a.toDeck('decision'); a.makeSlides('full');
a.toJSON(); a.fromJSON(doc);
```

Events on `document`: `aprc-read`, `aprc-changed` (detail `{ doc }`).

## Files

| File | Kind | Job |
| --- | --- | --- |
| `AprcModel.ts` | pure | The outline, numbering, states, whose words print in which copy, carry-over between readings |
| `AprcWrite.ts` | pure | The words: `writeGround`, `writeSymbols`, `writePlan`; first / last light |
| `AprcHtml.ts` | pure | The page and the print document |
| `AprcDocx.ts` | pure | The Word package |
| `AprcDeck.ts` | pure | The slides and the refresh merge |
| `GroundAppreciation.ts` | engine | Collects the readings, the sheet, exports |

`node tools/aprc-test/run.mjs` runs 86 checks on the pure files.

## The attack

`AprcKind` is `def | attk`. Only the defence has an outline. The attack has its place: `registerOutline('attk', label,
build)` adds its headings and a writer fills them, with no other change. It waits for a specimen.

## Not built yet (Appreciation_Plan.md s9, phases 4 to 6)

- En options with phase timings from the IPB decision view; the IPB weather values in Met Conditions.
- Relative strength ratios from the ORBAT (the table counts symbols by echelon and leaves the ratio).
- Tps to tasks, time required, coy grouping and tasks from the plan.
- Typing into tables in the sheet (fill them in Word).
- The appreciation saved inside the plan file (it is kept in the browser and as its own file).
- More than four lines of def (the reading gives W to Z).
